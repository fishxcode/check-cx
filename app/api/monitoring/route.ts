import {NextResponse} from "next/server";
import {parsePublicScope, resolvePublicScope} from "@/lib/core/public-scope";
import {getMonitoringStatistics} from "@/lib/database/monitoring-statistics";

export const dynamic = "force-dynamic";
const headers = {"Cache-Control": "no-store"};
/** 只返回公开聚合指标，不输出端点、密钥、配置标识或内部异常。 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const scope = parsePublicScope(params);
  const period = params.get("period") ?? "7d";
  if (!scope || !["24h", "7d", "15d", "30d"].includes(period) || params.getAll("period").length > 1) return NextResponse.json({error: "统计范围或时间窗口无效"}, {status: 400, headers});
  try {
    const resolved = await resolvePublicScope(scope);
    if (!resolved) return NextResponse.json({error: "未找到该监控范围"}, {status: 404, headers});
    const snapshot = await getMonitoringStatistics();
    if (!snapshot.available) return NextResponse.json({error: "统计暂不可用"}, {status: 503, headers});
    const statistic = snapshot.stats.find((row) => row.scopeType === scope.scope && row.scopeKey === resolved.key && row.period === period) ?? null;
    return NextResponse.json({scope: scope.scope, value: scope.scope === "all" ? null : resolved.key, period, asOf: snapshot.asOf,
      basis: "probe_samples", latencyMetric: "time_to_first_token_ms", statistic}, {headers});
  } catch { return NextResponse.json({error: "统计暂不可用"}, {status: 503, headers}); }
}
