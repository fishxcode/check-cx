import "server-only";
import {getPublicConfigs} from "@/lib/database/public-configs";
import {getConfiguredModelVendors} from "./model-pricing";
import {getModelPath, getModelSlugMap} from "@/lib/utils/model-slug";
import {UNKNOWN_VENDOR} from "@/lib/utils/vendor-groups";
import type {PublicScope} from "./public-metadata";

export function parsePublicScope(params: URLSearchParams): PublicScope | null {
  const scope = params.get("scope") ?? "all";
  const value = params.get("value") ?? undefined;
  if (!["all", "model", "group", "vendor"].includes(scope) || ["scope", "value"].some((key) => params.getAll(key).length > 1)) return null;
  if (scope === "all" ? Boolean(value) : !value || value.length > 200) return null;
  return {scope: scope as PublicScope["scope"], value};
}

/** 以安全公开目录判定范围，包含停用配置以保留历史入口。 */
export async function resolvePublicScope(scope: PublicScope) {
  const configs = await getPublicConfigs();
  let modelNames = [...new Set(configs.map((row) => row.model))];
  let key = "all";
  let title = "全部模型";
  let path = "/";
  let groupName: string | null = null;
  let normalized = scope;
  if (scope.scope === "model") {
    const model = getModelSlugMap(modelNames).get(scope.value ?? "");
    if (!model) return null;
    modelNames = [model]; key = model; title = model; path = getModelPath(model);
    normalized = {scope: "model", value: path.slice("/model/".length)};
  } else if (scope.scope === "group") {
    if (!configs.some((row) => (row.group_name || "__ungrouped__") === scope.value)) return null;
    key = scope.value!; groupName = key; title = key === "__ungrouped__" ? "未分组" : key;
    path = `/group/${encodeURIComponent(key)}`;
  } else if (scope.scope === "vendor") {
    const vendors = await getConfiguredModelVendors(modelNames);
    const vendor = [UNKNOWN_VENDOR, ...Object.values(vendors)].find((item) => item.name === scope.value)
      ?? [UNKNOWN_VENDOR, ...Object.values(vendors)].find((item) => item.id === scope.value);
    if (!vendor) return null;
    modelNames = modelNames.filter((model) => (vendors[model]?.id ?? UNKNOWN_VENDOR.id) === vendor.id);
    if (!modelNames.length) return null;
    key = vendor.id; title = vendor.displayName; path = `/vendor/${encodeURIComponent(vendor.name)}`;
    normalized = {scope: "vendor", value: vendor.name};
  }
  return {scope: normalized, key, title, path, modelNames, groupName};
}
