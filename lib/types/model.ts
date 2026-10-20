import type {AvailabilityStat} from "./dashboard";
import type {HealthStatus} from "./check";
import type {ProviderType} from "./provider";

export interface ModelGroupRatio {
  name: string;
  ratio: number;
}

export interface ModelApiEndpoint {
  name: string;
  method: string;
  path: string;
}

export interface ModelPricingMetadata {
  description: string | null;
  tags: string[];
  vendor: {
    name: string;
    description: string | null;
  } | null;
  quotaType: number | null;
  modelRatio: number | null;
  modelPrice: number | null;
  completionRatio: number | null;
  cacheRatio: number | null;
  createCacheRatio: number | null;
  groups: string[];
  groupRatios: ModelGroupRatio[];
  supportedEndpointTypes: string[];
  endpoints: ModelApiEndpoint[];
}

export interface ModelHistoryItem {
  status: HealthStatus;
  latencyMs: number | null;
  pingLatencyMs: number | null;
  checkedAt: string;
}

export interface ModelMonitorSource {
  id: string;
  name: string;
  providerType: ProviderType;
  isMaintenance: boolean;
  availabilityStats: AvailabilityStat[];
  history: ModelHistoryItem[];
}

export interface ModelDetailData {
  modelName: string;
  pricing: ModelPricingMetadata | null;
  sources: ModelMonitorSource[];
}
