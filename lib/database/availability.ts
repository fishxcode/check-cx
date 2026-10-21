/** 完整探测窗口统计的兼容接口。 */
import "server-only";

import {clearMonitoringStatisticsCache, getMonitoringStatistics} from "./monitoring-statistics";
import type {AvailabilityStatsMap} from "../types";

const metrics = {hits: 0, misses: 0};
export const getAvailabilityCacheMetrics = () => ({...metrics});
export function resetAvailabilityCacheMetrics() { metrics.hits = 0; metrics.misses = 0; }
export function clearAvailabilityStatsCache() { clearMonitoringStatisticsCache(); }

export async function getAvailabilityStats(configIds?: Iterable<string> | null): Promise<AvailabilityStatsMap> {
  const allowed = configIds ? new Set(configIds) : null;
  if (allowed?.size === 0) return {};
  metrics.misses += 1;
  const snapshot = await getMonitoringStatistics();
  const result: AvailabilityStatsMap = {};
  for (const stat of snapshot.stats) {
    if (stat.scopeType !== "config" || (allowed && !allowed.has(stat.scopeKey))) continue;
    (result[stat.scopeKey] ??= []).push({
      period: stat.period,
      totalChecks: stat.totalChecks,
      successCount: stat.successCount,
      operationalCount: stat.operationalCount,
      availabilityPct: stat.availabilityPct,
    });
  }
  return result;
}
