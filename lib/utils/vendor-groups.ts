import type {DashboardData, GroupedProviderTimelines} from "@/lib/types";
import type {ModelVendor, PendingMonitor} from "@/lib/types/dashboard";

export const UNKNOWN_VENDOR: ModelVendor = {
  id: "other",
  name: "未识别厂家",
  displayName: "其他 / 未识别厂家",
  icon: null,
};

export interface VendorGroup extends GroupedProviderTimelines {
  vendor: ModelVendor;
  pendingConfigs: PendingMonitor[];
}

export function getModelVendor(data: DashboardData, model: string): ModelVendor {
  return data.modelVendors?.[model] ?? UNKNOWN_VENDOR;
}

/** 保留配置 ID，避免同一模型的多个渠道被合并丢失。 */
export function buildVendorGroups(data: DashboardData): VendorGroup[] {
  const groups = new Map<string, VendorGroup>();
  const ensureGroup = (model: string) => {
    const vendor = getModelVendor(data, model);
    let group = groups.get(vendor.id);
    if (!group) {
      group = {
        groupName: vendor.id,
        displayName: vendor.displayName,
        tags: "",
        timelines: [],
        pendingConfigs: [],
        vendor,
      };
      groups.set(vendor.id, group);
    }
    return group;
  };
  for (const timeline of data.providerTimelines) {
    ensureGroup(timeline.latest.model).timelines.push(timeline);
  }
  for (const config of data.pendingConfigs ?? []) {
    ensureGroup(config.model).pendingConfigs.push(config);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.vendor.id === b.vendor.id) return 0;
    if (a.vendor.id === UNKNOWN_VENDOR.id) return 1;
    if (b.vendor.id === UNKNOWN_VENDOR.id) return -1;
    return a.displayName.localeCompare(b.displayName, "zh-CN");
  });
}

/** 每次轮询后重新过滤，厂家详情不会混入其他厂家的检测项。 */
export function scopeDashboardToVendor(data: DashboardData, vendorId?: string): DashboardData {
  if (!vendorId) return data;
  // URL 使用厂家名称；仍兼容旧编号，纯数字名称优先按名称解析。
  const vendors = [UNKNOWN_VENDOR, ...Object.values(data.modelVendors ?? {})];
  const resolvedId = vendors.find((vendor) => vendor.name === vendorId)?.id ?? vendorId;
  const providerTimelines = data.providerTimelines.filter(
    (timeline) => getModelVendor(data, timeline.latest.model).id === resolvedId
  );
  const pendingConfigs = (data.pendingConfigs ?? []).filter(
    (config) => getModelVendor(data, config.model).id === resolvedId
  );
  const timestamps = providerTimelines.flatMap((timeline) => timeline.items.map((item) => item.checkedAt))
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return {
    ...data,
    providerTimelines,
    pendingConfigs,
    total: providerTimelines.length + pendingConfigs.length,
    lastUpdated: timestamps[0] ?? null,
  };
}
