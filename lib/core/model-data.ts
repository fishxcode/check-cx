import "server-only";

import {cache} from "react";

import {getAvailabilityStats} from "@/lib/database/availability";
import {loadProviderConfigsFromDB} from "@/lib/database/config-loader";
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

    const configs = await loadProviderConfigsFromDB();
    const matchingConfigs = configs.filter((config) => config.model === modelName);
    if (matchingConfigs.length === 0) {
      return null;
    }

    const configIds = matchingConfigs.map((config) => config.id);
    const [pricing, history, availabilityStats] = await Promise.all([
      getModelPricingMetadata(modelName),
      historySnapshotStore.fetch({
        allowedIds: configIds,
        limitPerConfig: MAX_POINTS_PER_PROVIDER,
      }),
      getAvailabilityStats(configIds),
    ]);

    const sources: ModelMonitorSource[] = matchingConfigs.map((config) => ({
      id: config.id,
      name: config.name,
      providerType: config.type,
      isMaintenance: config.is_maintenance,
      availabilityStats: availabilityStats[config.id] ?? [],
      history: (history[config.id] ?? []).slice(0, MODEL_HISTORY_LIMIT).map((item) => ({
        status: item.status,
        latencyMs: item.latencyMs,
        pingLatencyMs: item.pingLatencyMs,
        checkedAt: item.checkedAt,
      })),
    }));

    return {modelName, pricing, sources};
  }
);

export async function getMonitoredModelNames(): Promise<string[]> {
  const configs = await loadProviderConfigsFromDB();
  return [...new Set(configs.map((config) => config.model).filter(Boolean))].sort();
}

export async function resolveMonitoredModelSlug(slug: string): Promise<string | null> {
  const modelNames = await getMonitoredModelNames();
  return getModelSlugMap(modelNames).get(slug) ?? null;
}
