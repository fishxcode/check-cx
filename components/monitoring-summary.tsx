"use client";

import {useMonitoringDisplay} from "@/components/monitoring-display-context";
import {ClientTime} from "@/components/client-time";
import type {AvailabilityPeriod} from "@/lib/types";
import type {MonitoringScopeType, MonitoringSnapshot, MonitoringStatistic} from "@/lib/types/monitoring";

export function metricValue(value: number | null | undefined, unit = "") {
  return typeof value === "number" && Number.isFinite(value)
    ? `${new Intl.NumberFormat("zh-CN", {maximumFractionDigits: unit === "%" ? 2 : 0}).format(value)}${unit}` : "—";
}

export function MonitoringSummary({snapshot, scopeType, scopeKey, period, compact = false}: {
  snapshot?: MonitoringSnapshot;
  scopeType: MonitoringScopeType;
  scopeKey: string;
  period: AvailabilityPeriod;
  compact?: boolean;
}) {
  if (!snapshot?.available) return null;
  const stat = snapshot.stats.find((row) => row.scopeType === scopeType && row.scopeKey === scopeKey && row.period === period);
  const values = [
    ["探测可用率 / SLA", metricValue(stat?.availabilityPct, "%")],
    ["延迟达标率", metricValue(stat?.attainmentPct, "%")],
    ["平均首字延迟", metricValue(stat?.meanLatencyMs, " ms")],
    ["P95 首字延迟", metricValue(stat?.p95LatencyMs, " ms")],
  ].filter((_, index) => snapshot.showSla !== false || index > 1);
  return <section aria-label="窗口统计" className="space-y-3">
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{values.map(([label, value]) => <div key={label} className="min-w-0 rounded-xl border border-border/60 bg-card p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt><dd className={`mt-2 font-semibold tabular-nums ${compact ? "text-lg" : "text-2xl sm:text-3xl"}`}>{value}</dd>
    </div>)}</dl>
    <div className="text-xs leading-6 text-muted-foreground"><p>{stat?.totalChecks ? `${stat.totalChecks.toLocaleString("zh-CN")} 次探测 · ${stat.latencySampleCount.toLocaleString("zh-CN")} 个有效延迟样本` : "所选窗口暂无探测样本"}。{snapshot.showSla !== false && "可用率按探测次数计算，非按持续时间计算的 SLA；维护不计入。"}</p>
      {!compact && stat?.firstSampleAt && stat.lastSampleAt && <p>样本覆盖：<ClientTime value={stat.firstSampleAt} /> 至 <ClientTime value={stat.lastSampleAt} />，期间可能缺测。</p>}
      {!compact && !!stat?.inferredAttributionCount && <p>部分记录按迁移或写入时配置归属统计。</p>}
    </div>
  </section>;
}

/** 独立柱形保留每个实际采样桶，不用折线跨越缺测区间。 */
export function MonitoringTrend({statistic}: {statistic?: MonitoringStatistic}) {
  const display = useMonitoringDisplay();
  if (!display.showSla || !display.available) return null;
  const points = statistic?.trend ?? [];
  return <section className="rounded-2xl border border-border/60 bg-card p-5 sm:p-6">
    <h2 className="font-semibold">窗口内可用率</h2><p className="mt-1 text-xs text-muted-foreground">有样本桶序列：每根柱表示一个有样本的时间桶，间距不代表时间长度；缺测不代表可用。</p>
    {!points.length ? <p className="py-10 text-sm text-muted-foreground">暂无趋势样本</p> : <>
      <div className="mt-6 flex h-36 items-end gap-1" aria-label="可用率柱状图">{points.map((point) => <div key={point.at} className="flex h-full min-w-0 flex-1 items-end" title={`${point.at} · ${metricValue(point.availabilityPct, "%")} · ${point.totalChecks} 次探测`}><div className={`w-full rounded-t ${point.availabilityPct === 0 ? "border-t-2 border-red-500" : point.availabilityPct < 99 ? "bg-amber-500/75" : "bg-emerald-500/75"}`} style={{height: `${Math.max(0, Math.min(100, point.availabilityPct))}%`}} /></div>)}</div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground"><ClientTime value={points[0].at} /><ClientTime value={points[points.length - 1].at} /></div>
      <details className="mt-5 text-xs"><summary className="cursor-pointer text-muted-foreground">查看采样桶明细</summary><div className="mt-3 max-h-64 overflow-auto"><table className="w-full text-left"><thead><tr><th>采样时间</th><th>样本数</th><th>可用率</th><th>平均延迟</th></tr></thead><tbody>{points.map((point) => <tr key={point.at} className="border-t border-border/40"><td className="py-2"><ClientTime value={point.at} /></td><td>{point.totalChecks}</td><td>{metricValue(point.availabilityPct, "%")}</td><td>{metricValue(point.meanLatencyMs, " ms")}</td></tr>)}</tbody></table></div></details>
    </>}
  </section>;
}
