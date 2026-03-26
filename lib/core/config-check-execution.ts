/**
 * 指定配置检测执行器
 * 供手动批量检测、调度接口和轮询器复用
 */

import {clearAvailabilityStatsCache} from "@/lib/database/availability";
import {historySnapshotStore} from "@/lib/database/history";
import {runProviderChecks} from "@/lib/providers";
import type {CheckResult, ProviderConfig} from "@/lib/types";

import {evaluateAlerts} from "./alert-engine";
import {clearDashboardDataCache} from "./dashboard-data";
import {clearGroupDashboardCache} from "./group-data";
import {clearPingCache} from "./global-state";
import {sendPollSummary} from "./poll-summary";

export async function runChecksForConfigs(
  configs: ProviderConfig[]
): Promise<CheckResult[]> {
  const activeConfigs = configs.filter((config) => !config.is_maintenance);
  if (activeConfigs.length === 0) {
    return [];
  }

  const results = await runProviderChecks(activeConfigs);

  await historySnapshotStore.append(results);
  await Promise.allSettled(
    results.map((result) =>
      evaluateAlerts(result.id, result.name, result.status, result.latencyMs ?? null)
    )
  );
  await sendPollSummary(results).catch(() => {});

  clearPingCache();
  clearDashboardDataCache();
  clearGroupDashboardCache();
  clearAvailabilityStatsCache();

  return results;
}
