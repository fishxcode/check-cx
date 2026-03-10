/**
 * 可用性统计查询模块
 */

import "server-only";

import {createAdminClient} from "../supabase/admin";
import {getPollingIntervalMs} from "../core/polling-config";
import type {AvailabilityStats} from "../types/database";
import type {AvailabilityPeriod, AvailabilityStat, AvailabilityStatsMap} from "../types";
import {logError} from "../utils";

interface AvailabilityCache {
  data: AvailabilityStatsMap;
  lastFetchedAt: number;
}

interface AvailabilityCacheMetrics {
  hits: number;
  misses: number;
}

const cache: AvailabilityCache = {
  data: {},
  lastFetchedAt: 0,
};

const metrics: AvailabilityCacheMetrics = {
  hits: 0,
  misses: 0,
};

export function getAvailabilityCacheMetrics(): AvailabilityCacheMetrics {
  return { ...metrics };
}

export function resetAvailabilityCacheMetrics(): void {
  metrics.hits = 0;
  metrics.misses = 0;
}

export function clearAvailabilityStatsCache(): void {
  cache.data = {};
  cache.lastFetchedAt = 0;
}

function normalizeIds(ids?: Iterable<string> | null): string[] | null {
  if (!ids) {
    return null;
  }
  const normalized = Array.from(ids).filter(Boolean);
  return normalized.length > 0 ? normalized : [];
}

function filterStats(
  data: AvailabilityStatsMap,
  ids: string[] | null
): AvailabilityStatsMap {
  if (!ids) {
    return data;
  }
  if (ids.length === 0) {
    return {};
  }
  const result: AvailabilityStatsMap = {};
  for (const id of ids) {
    if (data[id]) {
      result[id] = data[id];
    }
  }
  return result;
}

function mapRows(rows: AvailabilityStats[] | null): AvailabilityStatsMap {
  if (!rows || rows.length === 0) {
    return {};
  }

  const mapped: AvailabilityStatsMap = {};
  for (const row of rows) {
    const entry: AvailabilityStat = {
      period: row.period,
      totalChecks: Number(row.total_checks ?? 0),
      operationalCount: Number(row.operational_count ?? 0),
      availabilityPct:
        row.availability_pct === null ? null : Number(row.availability_pct),
    };

    if (!mapped[row.config_id]) {
      mapped[row.config_id] = [];
    }
    mapped[row.config_id].push(entry);
  }

  return mapped;
}

interface HistoryRow {
  config_id: string;
  status: string;
  checked_at: string;
}

const PERIOD_MS: Array<{ period: AvailabilityPeriod; ms: number }> = [
  { period: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { period: "15d", ms: 15 * 24 * 60 * 60 * 1000 },
  { period: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
];

async function fallbackComputeAvailabilityStats(
  configIds: string[] | null
): Promise<AvailabilityStatsMap> {
  const supabase = createAdminClient();
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("check_history")
    .select("config_id,status,checked_at")
    .gte("checked_at", cutoff30d);

  if (configIds && configIds.length > 0) {
    query = query.in("config_id", configIds);
  }

  const { data, error } = await query;
  if (error) {
    logError("fallback 读取历史统计失败", error);
    return {};
  }

  const rows = (data ?? []) as HistoryRow[];
  const now = Date.now();
  const counters: Record<
    string,
    Record<AvailabilityPeriod, { totalChecks: number; operationalCount: number }>
  > = {};

  for (const row of rows) {
    const checkedAtMs = Date.parse(row.checked_at);
    if (!Number.isFinite(checkedAtMs)) {
      continue;
    }
    const ageMs = now - checkedAtMs;
    if (ageMs < 0) {
      continue;
    }

    if (!counters[row.config_id]) {
      counters[row.config_id] = {
        "7d": { totalChecks: 0, operationalCount: 0 },
        "15d": { totalChecks: 0, operationalCount: 0 },
        "30d": { totalChecks: 0, operationalCount: 0 },
      };
    }

    for (const { period, ms } of PERIOD_MS) {
      if (ageMs <= ms) {
        counters[row.config_id][period].totalChecks += 1;
        if (row.status === "operational") {
          counters[row.config_id][period].operationalCount += 1;
        }
      }
    }
  }

  const mapped: AvailabilityStatsMap = {};
  for (const [configId, periods] of Object.entries(counters)) {
    mapped[configId] = (["7d", "15d", "30d"] as AvailabilityPeriod[]).map((period) => {
      const periodData = periods[period];
      const pct =
        periodData.totalChecks > 0
          ? Number(((periodData.operationalCount / periodData.totalChecks) * 100).toFixed(2))
          : null;
      return {
        period,
        totalChecks: periodData.totalChecks,
        operationalCount: periodData.operationalCount,
        availabilityPct: pct,
      };
    });
  }

  return mapped;
}

export async function getAvailabilityStats(
  configIds?: Iterable<string> | null
): Promise<AvailabilityStatsMap> {
  const normalizedIds = normalizeIds(configIds);
  if (Array.isArray(normalizedIds) && normalizedIds.length === 0) {
    return {};
  }

  const ttl = getPollingIntervalMs();
  const now = Date.now();
  if (now - cache.lastFetchedAt < ttl && Object.keys(cache.data).length > 0) {
    metrics.hits += 1;
    return filterStats(cache.data, normalizedIds);
  }
  metrics.misses += 1;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("availability_stats")
    .select("config_id, period, total_checks, operational_count, availability_pct")
    .order("config_id", { ascending: true })
    .order("period", { ascending: true });

  if (error) {
    logError("读取可用性统计失败", error);
    // 兜底路径必须先计算全量数据，避免子集请求污染全局缓存
    const fallback = await fallbackComputeAvailabilityStats(null);
    cache.data = fallback;
    cache.lastFetchedAt = now;
    return filterStats(fallback, normalizedIds);
  }

  const mapped = mapRows(data as AvailabilityStats[] | null);
  cache.data = mapped;
  cache.lastFetchedAt = now;

  return filterStats(mapped, normalizedIds);
}
