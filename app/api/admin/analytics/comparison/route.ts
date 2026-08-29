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
const PALETTE = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6"];

interface Row {
  config_id: string;
  latency_ms: number | null;
  status: string;
}

// 排序后取百分位
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export async function GET(request: NextRequest) {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("config_ids");
  if (!idsParam) return NextResponse.json({ error: "缺少 config_ids" }, { status: 400 });

  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5);
  if (ids.length === 0) return NextResponse.json({ error: "config_ids 为空" }, { status: 400 });

  const period = searchParams.get("period") ?? "7d";
  const windowMs = PERIOD_MS[period] ?? PERIOD_MS["7d"];
  const since = new Date(Date.now() - windowMs).toISOString();

  const admin = createAdminClient();

  const { data: configRows, error: configErr } = await admin
    .from("check_configs")
    .select("id,name")
    .in("id", ids);
  if (configErr) return NextResponse.json({ error: configErr.message }, { status: 500 });

  const { data, error } = await admin
    .from("check_history")
    .select("config_id,latency_ms,status")
    .in("config_id", ids)
    .gte("checked_at", since)
    .order("checked_at", { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Row[];

  const byConfig = new Map<string, Row[]>();
  for (const id of ids) byConfig.set(id, []);
  for (const row of rows) byConfig.get(row.config_id)?.push(row);

  const nameMap = new Map((configRows ?? []).map((c) => [c.id, c.name]));

  const configs = ids.map((id, i) => ({
    id,
    name: nameMap.get(id) ?? id.slice(0, 8),
    color: PALETTE[i % PALETTE.length],
  }));

  const latencyData = ids.map((id) => {
    const group = byConfig.get(id) ?? [];
    const lats = group.map((r) => r.latency_ms).filter((v): v is number => v != null).sort((a, b) => a - b);
    const avg = lats.length > 0 ? Math.round(lats.reduce((s, v) => s + v, 0) / lats.length) : 0;
    return {
      config_id: id,
      avg,
      p50: percentile(lats, 50),
      p95: percentile(lats, 95),
      p99: percentile(lats, 99),
    };
  });

  const availabilityData = ids.map((id) => {
    const group = byConfig.get(id) ?? [];
    const count = group.length;
    const ok = group.filter((r) => OK_STATUS.has(r.status)).length;
    return {
      config_id: id,
      availability: count > 0 ? Number(((ok / count) * 100).toFixed(2)) : null,
      total_checks: count,
    };
  });

  return NextResponse.json({
    configs,
    metrics: {
      latency: { unit: "ms", data: latencyData },
      availability: { data: availabilityData },
    },
  });
}
