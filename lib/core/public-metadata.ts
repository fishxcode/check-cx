import "server-only";
import type {Metadata} from "next";
import {getSiteSeoConfig, toAbsoluteUrl} from "./site-seo";

export interface PublicScope {scope: "all" | "model" | "group" | "vendor"; value?: string}
export function scopeQuery(scope: PublicScope) {
  const query = new URLSearchParams({scope: scope.scope});
  if (scope.value) query.set("value", scope.value);
  return query.toString();
}
export async function publicMetadata({title, description, path, scope}: {title: string; description: string; path: string; scope: PublicScope}): Promise<Metadata> {
  const site = await getSiteSeoConfig();
  const absolute = (value: string) => toAbsoluteUrl(value, site.siteUrl) ?? value;
  const fullTitle = `${title} | ${site.title}`;
  const image = absolute(`/api/og?${scopeQuery(scope)}`);
  return {title, description, keywords: [...site.keywords, title, "模型监控", "API 延迟"],
    alternates: {canonical: absolute(path), types: {"application/rss+xml": absolute(`/rss.xml?${scopeQuery(scope)}`)}},
    openGraph: {type: "website", locale: "zh_CN", title: fullTitle, description, url: absolute(path), siteName: site.title, images: [{url: image, width: 1200, height: 630, alt: title}]},
    twitter: {card: "summary_large_image", title: fullTitle, description, images: [image]}};
}
