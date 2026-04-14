import type {MetadataRoute} from "next";

import {getSiteSeoConfig} from "@/lib/core/site-seo";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const {siteUrl} = await getSiteSeoConfig();

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/group/", "/rss.xml"],
        disallow: ["/admin/", "/api/admin/"],
      },
    ],
    sitemap: siteUrl ? `${siteUrl}/sitemap.xml` : undefined,
    host: siteUrl ?? undefined,
  };
}

