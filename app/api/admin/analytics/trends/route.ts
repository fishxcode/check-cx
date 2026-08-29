import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

const PERIOD_MS: Record<string, number> = {
  "24h": 86400_000,
  "7d": 7 * 86400_000,
  "30d": 30 * 86400_000,
};

const OK_STATUS = new Set(["operational", "degraded"]);

interface Row {
  checked_at: string;
  latency_ms: number | null;
  status: string;
}

// 按粒度生成分桶 key
function bucketKey(ts: number, granularity: string): number {
  const d = new Date(ts);
  if (granularity === "day") {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
}

export async function GET(request: NextRequest) {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const configId = searchParams.get("config_id");
  if (!configId) return NextResponse.json({ error: "缺少 config_id" }, { status: 400 });

  const period = searchParams.get("period") ?? "7d";
  const metric = searchParams.get("metric") ?? "latency";
  const granularity = searchParams.get("granularity") ?? "hour";
  const windowMs = PERIOD_MS[period] ?? PERIOD_MS["7d"];
  const since = new Date(Date.now() - windowMs).toISOString();

  const admin = createAdminClient();

  const { data: configRow, error: configErr } = await admin
    .from("check_configs")
    .select("id,name,type,model")
    .eq("id", configId)
    .single();
  if (configErr) return NextResponse.json({ error: configErr.message }, { status: 500 });

  const { data, error } = await admin
    .from("check_history")
    .select("checked_at,latency_ms,status")
    .eq("config_id", configId)
    .gte("checked_at", since)
    .order("checked_at", { ascending: true })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Row[];

  // 分桶聚合
  const buckets = new Map<number, Row[]>();
  for (const row of rows) {
    const key = bucketKey(new Date(row.checked_at).getTime(), granularity);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(row);
  }

  const result = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, group]) => {
      const count = group.length;
      let value = 0;
      let min = 0;
      let max = 0;

      if (metric === "latency") {
        const lats = group.map((r) => r.latency_ms).filter((v): v is number => v != null);
        if (lats.length > 0) {
          value = Math.round(lats.reduce((s, v) => s + v, 0) / lats.length);
          min = Math.min(...lats);
          max = Math.max(...lats);
        }
      } else if (metric === "availability") {
        const ok = group.filter((r) => OK_STATUS.has(r.status)).length;
        value = Number(((ok / count) * 100).toFixed(2));
        min = value;
        max = value;
      } else if (metric === "failure_rate") {
        const failed = group.filter((r) => !OK_STATUS.has(r.status)).length;
        value = Number(((failed / count) * 100).toFixed(2));
        min = value;
        max = value;
      }

      return { timestamp: new Date(key).toISOString(), value, min, max, count };
    });

  return NextResponse.json({
    config: configRow,
    metric,
    period,
    data: result,
  });
}
