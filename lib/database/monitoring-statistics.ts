import "server-only";

import {getConfiguredModelVendors} from "@/lib/core/model-pricing";
import {createAdminClient} from "@/lib/supabase/admin";
import type {MonitoringSnapshot, MonitoringStatistic} from "@/lib/types/monitoring";

let cached: {value: MonitoringSnapshot; expiresAt: number} | undefined;
let inflight: Promise<MonitoringSnapshot> | undefined;
let generation = 0;

export function clearMonitoringStatisticsCache() {
  generation += 1;
  cached = undefined;
  inflight = undefined;
}

const unavailable = (): MonitoringSnapshot => ({available: false, asOf: null, stats: []});

/** 数据库聚合完整窗口，失败时不以近期样本冒充完整统计。 */
export async function getMonitoringStatistics(): Promise<MonitoringSnapshot> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inflight) return inflight;
  const requestGeneration = generation;
  const request = loadStatistics().catch(() => unavailable()).then((value) => {
    if (generation === requestGeneration) {
      cached = {value, expiresAt: Date.now() + (value.available ? 30_000 : 15_000)};
    }
    return value;
  }).finally(() => {
    if (inflight === request) inflight = undefined;
  });
  inflight = request;
  return request;
}

async function loadStatistics(): Promise<MonitoringSnapshot> {
  const client = createAdminClient();
  const modelResult = await client.rpc("get_monitoring_model_names");
  if (modelResult.error || !Array.isArray(modelResult.data) || !modelResult.data.every((value: unknown) => typeof value === "string")) return unavailable();
  const models = new Set<string>(modelResult.data);
  const vendors = await getConfiguredModelVendors([...models]);
  const mapping = Object.fromEntries(Object.entries(vendors).map(([model, vendor]) => [model, vendor.id]));
  const {data, error} = await client.rpc("get_monitoring_statistics", {p_vendors: mapping});
  if (error || !data || typeof data !== "object" || !Array.isArray(data.stats) || typeof data.asOf !== "string") return unavailable();
  const valid = data.stats.every((row: MonitoringStatistic) =>
    ["all", "config", "model", "group", "vendor"].includes(row.scopeType)
    && ["24h", "7d", "15d", "30d"].includes(row.period)
    && typeof row.scopeKey === "string" && Number.isFinite(row.totalChecks)
    && [row.successCount, row.operationalCount, row.latencySampleCount, row.inferredAttributionCount].every(Number.isFinite)
    && [row.availabilityPct, row.attainmentPct, row.meanLatencyMs, row.p95LatencyMs].every((value) => value === null || Number.isFinite(value))
    && Array.isArray(row.trend) && row.trend.every((point) => typeof point.at === "string" && Number.isFinite(Date.parse(point.at)) && Number.isFinite(point.totalChecks) && Number.isFinite(point.availabilityPct) && (point.meanLatencyMs === null || Number.isFinite(point.meanLatencyMs))));
  return valid ? {available: true, asOf: data.asOf, stats: data.stats} : unavailable();
}
