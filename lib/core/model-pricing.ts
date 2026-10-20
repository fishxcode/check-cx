import "server-only";

import type {ModelApiEndpoint, ModelPricingMetadata} from "@/lib/types";

const PRICING_API_URL = "https://fishxcode.com/api/pricing";
const PRICING_CACHE_TTL_MS = 5 * 60 * 1000;

interface PricingModel {
  model_name: string;
  description?: string;
  tags?: string;
  vendor_id?: number;
  quota_type?: number;
  model_ratio?: number;
  model_price?: number;
  completion_ratio?: number;
  cache_ratio?: number;
  create_cache_ratio?: number;
  enable_groups?: string[];
  supported_endpoint_types?: string[];
}

interface PricingVendor {
  id: number;
  name: string;
  description?: string;
}

interface PricingCatalog {
  data: PricingModel[];
  vendors: PricingVendor[];
  groupRatio: Record<string, number>;
  supportedEndpoint: Record<string, {method: string; path: string}>;
}

let pricingCache: {catalog: PricingCatalog; fetchedAt: number} | null = null;
let pricingRequest: Promise<PricingCatalog | null> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const number = readOptionalNumber(item);
      return number === undefined ? [] : [[key, number]];
    })
  );
}

function readEndpointRecord(
  value: unknown
): Record<string, {method: string; path: string}> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (!isRecord(item)) {
        return [];
      }
      const method = readOptionalString(item.method);
      const path = readOptionalString(item.path);
      return method && path ? [[key, {method, path}]] : [];
    })
  );
}

function parsePricingCatalog(value: unknown): PricingCatalog | null {
  if (!isRecord(value) || !Array.isArray(value.data) || !Array.isArray(value.vendors)) {
    return null;
  }

  const data = value.data.flatMap((item): PricingModel[] => {
    if (!isRecord(item) || typeof item.model_name !== "string") {
      return [];
    }
    return [{
      model_name: item.model_name,
      description: readOptionalString(item.description),
      tags: readOptionalString(item.tags),
      vendor_id: readOptionalNumber(item.vendor_id),
      quota_type: readOptionalNumber(item.quota_type),
      model_ratio: readOptionalNumber(item.model_ratio),
      model_price: readOptionalNumber(item.model_price),
      completion_ratio: readOptionalNumber(item.completion_ratio),
      cache_ratio: readOptionalNumber(item.cache_ratio),
      create_cache_ratio: readOptionalNumber(item.create_cache_ratio),
      enable_groups: readStringArray(item.enable_groups),
      supported_endpoint_types: readStringArray(item.supported_endpoint_types),
    }];
  });

  const vendors = value.vendors.flatMap((item): PricingVendor[] => {
    if (!isRecord(item) || typeof item.id !== "number" || typeof item.name !== "string") {
      return [];
    }
    return [{
      id: item.id,
      name: item.name,
      description: readOptionalString(item.description),
    }];
  });

  return data.length > 0
    ? {
        data,
        vendors,
        groupRatio: readNumberRecord(value.group_ratio),
        supportedEndpoint: readEndpointRecord(value.supported_endpoint),
      }
    : null;
}

async function fetchPricingCatalog(): Promise<PricingCatalog> {
  const response = await fetch(PRICING_API_URL, {
    headers: {Accept: "application/json"},
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Pricing endpoint returned HTTP ${response.status}`);
  }

  const catalog = parsePricingCatalog(await response.json());
  if (!catalog) {
    throw new Error("Pricing endpoint returned an invalid catalog");
  }
  return catalog;
}

async function getPricingCatalog(): Promise<PricingCatalog | null> {
  if (pricingCache && Date.now() - pricingCache.fetchedAt < PRICING_CACHE_TTL_MS) {
    return pricingCache.catalog;
  }
  if (pricingRequest) {
    return pricingRequest;
  }

  pricingRequest = fetchPricingCatalog()
    .then((catalog) => {
      pricingCache = {catalog, fetchedAt: Date.now()};
      return catalog;
    })
    .catch((error: unknown) => {
      console.error("[check-cx] 获取模型价格元数据失败", error);
      return pricingCache?.catalog ?? null;
    })
    .finally(() => {
      pricingRequest = null;
    });

  return pricingRequest;
}

export async function getModelPricingMetadata(
  modelName: string
): Promise<ModelPricingMetadata | null> {
  const catalog = await getPricingCatalog();
  const model = catalog?.data.find((item) => item.model_name === modelName);
  if (!catalog || !model) {
    return null;
  }

  const vendor = catalog.vendors.find((item) => item.id === model.vendor_id);
  const groupRatios = (model.enable_groups ?? []).flatMap((name) => {
    const ratio = catalog.groupRatio[name];
    return ratio === undefined ? [] : [{name, ratio}];
  });
  const endpoints: ModelApiEndpoint[] = (model.supported_endpoint_types ?? []).flatMap(
    (name) => {
      const endpoint = catalog.supportedEndpoint[name];
      return endpoint ? [{name, ...endpoint}] : [];
    }
  );

  return {
    description: model.description ?? null,
    tags: model.tags?.split(",").map((tag) => tag.trim()).filter(Boolean) ?? [],
    vendor: vendor
      ? {name: vendor.name, description: vendor.description ?? null}
      : null,
    quotaType: model.quota_type ?? null,
    modelRatio: model.model_ratio ?? null,
    modelPrice: model.model_price ?? null,
    completionRatio: model.completion_ratio ?? null,
    cacheRatio: model.cache_ratio ?? null,
    createCacheRatio: model.create_cache_ratio ?? null,
    groups: model.enable_groups ?? [],
    groupRatios,
    supportedEndpointTypes: model.supported_endpoint_types ?? [],
    endpoints,
  };
}
