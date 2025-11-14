/**
 * Dashboard 数据聚合模块
 */

import { loadProviderConfigsFromDB } from "../database/config-loader";
import { runProviderChecks } from "../providers";
import { appendHistory, loadHistory } from "../database/history";
import { getPollingIntervalLabel, getPollingIntervalMs } from "./polling-config";
import { getPingCacheEntry } from "./global-state";
import type {
  ProviderTimeline,
  DashboardData,
  RefreshMode,
  HistorySnapshot,
} from "../types";

/**
 * 加载 Dashboard 数据
 * @param options 选项
 * @returns Dashboard 数据
 */
export async function loadDashboardData(options?: {
  refreshMode?: RefreshMode;
}): Promise<DashboardData> {
  const configs = await loadProviderConfigsFromDB();
  const allowedIds = new Set(configs.map((item) => item.id));
  const pollIntervalMs = getPollingIntervalMs();
  const pollIntervalLabel = getPollingIntervalLabel();
  const providerKey =
    allowedIds.size > 0 ? [...allowedIds].sort().join("|") : "__empty__";
  const cacheKey = `${pollIntervalMs}:${providerKey}`;
  const cacheEntry = getPingCacheEntry(cacheKey);

  const filterHistory = (history: HistorySnapshot): HistorySnapshot => {
    if (allowedIds.size === 0) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(history).filter(([id]) => allowedIds.has(id))
    );
  };

  const readFilteredHistory = async () => filterHistory(await loadHistory());

  const refreshHistory = async () => {
    if (allowedIds.size === 0) {
      return {};
    }
    const now = Date.now();
    if (cacheEntry.history && now - cacheEntry.lastPingAt < pollIntervalMs) {
      return cacheEntry.history;
    }
    if (cacheEntry.inflight) {
      return cacheEntry.inflight;
    }

    const inflightPromise = (async () => {
      const results = await runProviderChecks(configs);
      let nextHistory: HistorySnapshot;
      if (results.length > 0) {
        nextHistory = filterHistory(await appendHistory(results));
      } else {
        nextHistory = await readFilteredHistory();
      }
      cacheEntry.history = nextHistory;
      cacheEntry.lastPingAt = Date.now();
      return nextHistory;
    })();

    cacheEntry.inflight = inflightPromise;
    try {
      return await inflightPromise;
    } finally {
      if (cacheEntry.inflight === inflightPromise) {
        cacheEntry.inflight = undefined;
      }
    }
  };

  let history = await readFilteredHistory();
  const refreshMode = options?.refreshMode ?? "missing";

  if (refreshMode === "always") {
    history = await refreshHistory();
  } else if (
    refreshMode === "missing" &&
    allowedIds.size > 0 &&
    Object.keys(history).length === 0
  ) {
    history = await refreshHistory();
  }

  const mappedTimelines = Object.entries(history).map<ProviderTimeline | null>(
    ([id, items]) => {
      const sorted = [...items].sort(
        (a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()
      );

      if (sorted.length === 0) {
        return null;
      }

      return {
        id,
        items: sorted,
        latest: sorted[0],
      };
    }
  );

  const providerTimelines = mappedTimelines
    .filter((timeline): timeline is ProviderTimeline => Boolean(timeline))
    .sort((a, b) => a.latest.name.localeCompare(b.latest.name));

  const allEntries = providerTimelines
    .flatMap((timeline) => timeline.items)
    .sort(
      (a, b) =>
        new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()
    );

  const lastUpdated = allEntries.length ? allEntries[0].checkedAt : null;

  return {
    providerTimelines,
    lastUpdated,
    total: providerTimelines.length,
    pollIntervalLabel,
    pollIntervalMs,
  };
}
