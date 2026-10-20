import "server-only";
import {parseBillingExpression} from "@/lib/utils/billing-expression";

import type {ModelApiEndpoint, ModelPricingMetadata} from "@/lib/types";

import type {ModelVendor} from "@/lib/types/dashboard";

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
  billing_mode?: string;
  billing_expr?: string;
}

interface PricingVendor {
  icon?: string;
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
      billing_mode: readOptionalString(item.billing_mode),
      billing_expr: readOptionalString(item.billing_expr),
    }];
  });

  const vendors = value.vendors.flatMap((item): PricingVendor[] => {
    if (!isRecord(item) || typeof item.id !== "number" || typeof item.name !== "string") {
      return [];
    }
    return [{
      id: item.id,
      name: item.name,
      icon: readOptionalString(item.icon),
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
    billingMode: model.billing_mode?.trim() || null,
    billingExpr: model.billing_expr?.trim() || null,
    billingTiers: model.billing_expr ? parseBillingExpression(model.billing_expr) : [],
    groups: model.enable_groups ?? [],
    groupRatios,
    supportedEndpointTypes: model.supported_endpoint_types ?? [],
    endpoints,
  };
}

const VENDOR_BRANDS: Record<string, string> = {
  Google: "Gemini",
  Anthropic: "Claude",
  xAI: "Grok",
  阿里巴巴: "Qwen",
  智谱: "GLM",
};

/** 批量解析当前配置的厂家，不把目录中未配置的模型带入首页。 */
export async function getConfiguredModelVendors(
  modelNames: string[]
): Promise<Record<string, ModelVendor>> {
  if (modelNames.length === 0) return {};
  const catalog = await getPricingCatalog();
  if (!catalog) return {};

  const models = new Map(catalog.data.map((model) => [model.model_name, model]));
  const vendors = new Map(catalog.vendors.map((vendor) => [vendor.id, vendor]));
  const entries: Array<[string, ModelVendor]> = [];
  for (const modelName of new Set(modelNames)) {
    const model = models.get(modelName);
    const vendor = model?.vendor_id === undefined ? undefined : vendors.get(model.vendor_id);
    if (!vendor) continue;
    const brand = VENDOR_BRANDS[vendor.name];
    entries.push([modelName, {
      id: String(vendor.id),
      name: vendor.name,
      displayName: brand ? `${brand} / ${vendor.name}` : vendor.name,
      icon: vendor.icon ?? null,
    }]);
  }
  return Object.fromEntries(entries);
}

/** 仅输出已配置模型的公开描述，不扩展监控目录。 */
export async function getConfiguredModelDescriptions(modelNames: string[]): Promise<Record<string, string>> {
  const catalog = await getPricingCatalog();
  if (!catalog) return {};
  const allowed = new Set(modelNames);
  return Object.fromEntries(catalog.data.filter((model) => allowed.has(model.model_name) && model.description?.trim()).map((model) => [model.model_name, model.description!.trim()]));
}

/** 仅输出已配置模型中存在倍率的上游模型分组，供未配置渠道分组时作展示标签。 */
export async function getConfiguredModelGroups(modelNames: string[]): Promise<Record<string, string[]>> {
  const catalog = await getPricingCatalog();
  if (!catalog) return {};
  const allowed = new Set(modelNames);
  return Object.fromEntries(catalog.data
    .filter((model) => allowed.has(model.model_name))
    .map((model) => [model.model_name, [...new Set(model.enable_groups ?? [])].filter((name) => name.trim().length > 0 && Number.isFinite(catalog.groupRatio[name]) && catalog.groupRatio[name] >= 0)]));
}
