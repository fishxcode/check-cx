import "server-only";

import {cache} from "react";

import {getDisplayMonitoringStatistics} from "./monitoring-display";
import {getAvailabilityStats} from "@/lib/database/availability";
import {getPublicConfigs} from "@/lib/database/public-configs";
import {historySnapshotStore, MAX_POINTS_PER_PROVIDER} from "@/lib/database/history";
import {getModelPricingMetadata} from "@/lib/core/model-pricing";
import type {ModelDetailData, ModelMonitorSource} from "@/lib/types";
import {getModelSlugMap} from "@/lib/utils/model-slug";

const MODEL_HISTORY_LIMIT = 24;

export const getModelDetail = cache(
  async (modelName: string): Promise<ModelDetailData | null> => {
    if (!modelName || modelName.length > 200) {
      return null;
    }

    const configs = await getPublicConfigs();
    const matchingConfigs = configs.filter((config) => config.model === modelName);
    if (matchingConfigs.length === 0) {
      return null;
    }

    const configIds = matchingConfigs.map((config) => config.id);
    const [pricing, history, availabilityStats, snapshot] = await Promise.all([
      getModelPricingMetadata(modelName),
      historySnapshotStore.fetch({
        allowedIds: configIds,
        limitPerConfig: MAX_POINTS_PER_PROVIDER,
      }),
      getAvailabilityStats(configIds),
      getDisplayMonitoringStatistics(),
    ]);

    const sources: ModelMonitorSource[] = matchingConfigs.map((config) => ({
      id: config.id,
      enabled: config.enabled && !config.sync_disabled,
      name: config.name,
      providerType: config.type,
      isMaintenance: config.is_maintenance,
      groupName: config.group_name ?? null,
      availabilityStats: availabilityStats[config.id] ?? [],
      history: (history[config.id] ?? []).slice(0, MODEL_HISTORY_LIMIT).map((item) => ({
        status: item.status,
        latencyMs: item.latencyMs,
        pingLatencyMs: item.pingLatencyMs,
        checkedAt: item.checkedAt,
      })),
    }));

    const monitoring = {...snapshot, stats: snapshot.stats.filter((stat) => stat.scopeType === "model" && stat.scopeKey === modelName)};
    return {modelName, pricing, sources, monitoring};
  }
);

export async function getMonitoredModelNames(): Promise<string[]> {
  const configs = await getPublicConfigs();
  return [...new Set(configs.map((config) => config.model).filter(Boolean))].sort();
}

export async function resolveMonitoredModelSlug(slug: string): Promise<string | null> {
  const modelNames = await getMonitoredModelNames();
  return getModelSlugMap(modelNames).get(slug) ?? null;
}
