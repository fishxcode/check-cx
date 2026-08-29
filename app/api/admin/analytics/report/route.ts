import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

const PERIOD_MS: Record<string, number> = {
  "7d": 7 * 86400_000,
  "30d": 30 * 86400_000,
};

const OK_STATUS = new Set(["operational", "degraded"]);

interface Row {
  config_id: string;
  latency_ms: number | null;
  status: string;
}

interface Stat {
  id: string;
  name: string;
  total: number;
  failures: number;
  availability: number;
  avg_latency: number;
}

// 计算一组历史记录的可用率、失败数、平均延迟
function aggregate(rows: Row[]) {
  const total = rows.length;
  const failures = rows.filter((r) => !OK_STATUS.has(r.status)).length;
  const ok = total - failures;
  const lats = rows.map((r) => r.latency_ms).filter((v): v is number => v != null);
  const avg = lats.length > 0 ? Math.round(lats.reduce((s, v) => s + v, 0) / lats.length) : 0;
  return {
    total,
    failures,
    availability: total > 0 ? Number(((ok / total) * 100).toFixed(2)) : 0,
    avg_latency: avg,
  };
}

// 对比两个数值输出趋势方向（value 越高越好时 higherBetter=true）
function direction(current: number, previous: number, threshold: number, higherBetter: boolean) {
  const delta = current - previous;
  if (Math.abs(delta) < threshold) return "stable";
  const better = higherBetter ? delta > 0 : delta < 0;
  return better ? "improving" : "declining";
}

export async function GET(request: NextRequest) {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("config_ids");
  const period = searchParams.get("period") ?? "7d";
  const windowMs = PERIOD_MS[period] ?? PERIOD_MS["7d"];

  const now = Date.now();
  const since = new Date(now - windowMs).toISOString();
  const prevSince = new Date(now - windowMs * 2).toISOString();

  const admin = createAdminClient();

  // 确定目标配置：显式指定则用之，否则全部启用配置
  let configQuery = admin.from("check_configs").select("id,name,type,model").eq("enabled", true);
  if (idsParam) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) configQuery = admin.from("check_configs").select("id,name,type,model").in("id", ids);
  }
  const { data: configRows, error: configErr } = await configQuery;
  if (configErr) return NextResponse.json({ error: configErr.message }, { status: 500 });

  const configs = configRows ?? [];
  const ids = configs.map((c) => c.id);

  const emptyReport = {
    period,
    summary: { total_configs: 0, active_configs: 0, avg_availability: null, total_checks: 0, total_failures: 0 },
    top_performers: [],
    worst_performers: [],
    anomalies: [],
    trends: { availability: "stable", latency: "stable", failures: "stable" },
  };
  if (ids.length === 0) return NextResponse.json(emptyReport);

  // 拉取当前周期与上一周期历史
  const [{ data: curData, error: curErr }, { data: prevData }] = await Promise.all([
    admin
      .from("check_history")
      .select("config_id,latency_ms,status")
      .in("config_id", ids)
      .gte("checked_at", since)
      .order("checked_at", { ascending: false })
      .limit(8000),
    admin
      .from("check_history")
      .select("config_id,latency_ms,status")
      .in("config_id", ids)
      .gte("checked_at", prevSince)
      .lt("checked_at", since)
      .order("checked_at", { ascending: false })
      .limit(8000),
  ]);
  if (curErr) return NextResponse.json({ error: curErr.message }, { status: 500 });

  const curRows = (curData ?? []) as Row[];
  const prevRows = (prevData ?? []) as Row[];

  const byConfig = new Map<string, Row[]>();
  for (const id of ids) byConfig.set(id, []);
  for (const row of curRows) byConfig.get(row.config_id)?.push(row);

  const stats: Stat[] = configs.map((c) => {
    const agg = aggregate(byConfig.get(c.id) ?? []);
    return { id: c.id, name: c.name, ...agg };
  });

  const withData = stats.filter((s) => s.total > 0);

  const totalChecks = stats.reduce((s, r) => s + r.total, 0);
  const totalFailures = stats.reduce((s, r) => s + r.failures, 0);
  const avgAvailability =
    withData.length > 0
      ? Number((withData.reduce((s, r) => s + r.availability, 0) / withData.length).toFixed(2))
      : null;

  const sortedByAvail = [...withData].sort((a, b) => b.availability - a.availability);

  const toEntry = (s: Stat) => ({
    id: s.id,
    name: s.name,
    availability: s.availability,
    avg_latency: s.avg_latency,
  });

  const topPerformers = sortedByAvail.slice(0, 5).map(toEntry);
  const worstPerformers = [...sortedByAvail].reverse().slice(0, 5).map(toEntry);

  // 异常检测：失败率 > 20% 记 high；平均延迟 > 10000ms 记 medium
  const anomalies: { config_id: string; name: string; type: string; severity: string; detail: string }[] = [];
  for (const s of withData) {
    const failureRate = (s.failures / s.total) * 100;
    if (failureRate > 20) {
      anomalies.push({
        config_id: s.id,
        name: s.name,
        type: "high_failure_rate",
        severity: "high",
        detail: `失败率 ${failureRate.toFixed(1)}%`,
      });
    }
    if (s.avg_latency > 10000) {
      anomalies.push({
        config_id: s.id,
        name: s.name,
        type: "high_latency",
        severity: "medium",
        detail: `平均延迟 ${s.avg_latency}ms`,
      });
    }
  }

  // 趋势对比：本周期 vs 上一周期整体聚合
  const curAgg = aggregate(curRows);
  const prevAgg = aggregate(prevRows);

  const trends = {
    availability: direction(curAgg.availability, prevAgg.availability, 1, true),
    latency: direction(curAgg.avg_latency, prevAgg.avg_latency, 50, false),
    failures: direction(curAgg.failures, prevAgg.failures, 1, false),
  };

  return NextResponse.json({
    period,
    summary: {
      total_configs: configs.length,
      active_configs: withData.length,
      avg_availability: avgAvailability,
      total_checks: totalChecks,
      total_failures: totalFailures,
    },
    top_performers: topPerformers,
    worst_performers: worstPerformers,
    anomalies,
    trends,
  });
}
