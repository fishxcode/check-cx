import {getConfiguredModelVendors} from "@/lib/core/model-pricing";
import type {MetadataRoute} from "next";

import {getAvailableGroups} from "@/lib/core/group-data";
import {getMonitoredModelNames} from "@/lib/core/model-data";
import {getSiteSeoConfig} from "@/lib/core/site-seo";
import {getModelPath, getModelSlugMap} from "@/lib/utils/model-slug";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const {siteUrl} = await getSiteSeoConfig();
  if (!siteUrl) {
    return [];
  }

  const [groups, modelNames] = await Promise.all([
    getAvailableGroups(),
    getMonitoredModelNames(),
  ]);
  const modelSlugMap = getModelSlugMap(modelNames);
  const vendors = [...new Map(Object.values(await getConfiguredModelVendors(modelNames)).map((vendor) => [vendor.id, vendor])).values()];

  return [
    {
      url: siteUrl,
      changeFrequency: "always",
      priority: 1,
    },
    ...groups.map((groupName) => ({
      url: `${siteUrl}/group/${encodeURIComponent(groupName)}`,
      changeFrequency: "hourly" as const,
      priority: 0.8,
    })),
    ...vendors.map((vendor) => ({url: `${siteUrl}/vendor/${encodeURIComponent(vendor.name)}`, changeFrequency: "hourly" as const, priority: 0.7})),
    ...[...modelSlugMap.values()].flatMap((modelName) => ["", "/performance", "/api"].map((suffix) => ({
      url: `${siteUrl}${getModelPath(modelName)}${suffix}`, changeFrequency: "hourly" as const, priority: suffix ? 0.6 : 0.7,
    }))),
  ];
}
