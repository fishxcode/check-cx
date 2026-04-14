import type {MetadataRoute} from "next";

import {getAvailableGroups} from "@/lib/core/group-data";
import {getSiteSeoConfig} from "@/lib/core/site-seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const {siteUrl} = await getSiteSeoConfig();
  if (!siteUrl) {
    return [];
  }

  const groups = await getAvailableGroups();
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
  ];
}

