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
  const now = new Date();

  return [
    {
      url: siteUrl,
      lastModified: now,
      changeFrequency: "always",
      priority: 1,
    },
    ...groups.map((groupName) => ({
      url: `${siteUrl}/group/${encodeURIComponent(groupName)}`,
      lastModified: now,
      changeFrequency: "hourly" as const,
      priority: 0.8,
    })),
    ...[...modelSlugMap.values()].map((modelName) => ({
      url: `${siteUrl}${getModelPath(modelName)}`,
      lastModified: now,
      changeFrequency: "hourly" as const,
      priority: 0.7,
    })),
  ];
}

