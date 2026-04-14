import {NextResponse} from "next/server";

import {loadDashboardData} from "@/lib/core/dashboard-data";
import {STATUS_META} from "@/lib/core/status";
import {getSiteSeoConfig, toAbsoluteUrl} from "@/lib/core/site-seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const [{title, description, siteUrl}, dashboard] = await Promise.all([
    getSiteSeoConfig(),
    loadDashboardData({refreshMode: "never"}),
  ]);

  const feedUrl = toAbsoluteUrl("/rss.xml", siteUrl) ?? "/rss.xml";
  const homeUrl = siteUrl ?? "";
  const latestItems = dashboard.providerTimelines
    .slice()
    .sort((a, b) => Date.parse(b.latest.checkedAt) - Date.parse(a.latest.checkedAt))
    .slice(0, 30);

  const itemsXml = latestItems
    .map((timeline) => {
      const latest = timeline.latest;
      const statusMeta = STATUS_META[latest.status];
      const itemTitle = `${statusMeta.label} · ${latest.name}`;
      const groupLink = latest.groupName
        ? toAbsoluteUrl(`/group/${encodeURIComponent(latest.groupName)}`, siteUrl)
        : toAbsoluteUrl("/", siteUrl);
      const itemLink = groupLink ?? homeUrl;
      const itemDescription = [
        `Provider: ${latest.type}`,
        `Model: ${latest.model}`,
        `Status: ${statusMeta.label}`,
        `Latency: ${latest.latencyMs ?? "—"} ms`,
        `Ping: ${latest.pingLatencyMs ?? "—"} ms`,
        latest.message ? `Message: ${latest.message}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      return [
        "<item>",
        `<title>${escapeXml(itemTitle)}</title>`,
        itemLink ? `<link>${escapeXml(itemLink)}</link>` : "",
        `<guid isPermaLink="false">${escapeXml(`${latest.id}:${latest.checkedAt}`)}</guid>`,
        `<pubDate>${new Date(latest.checkedAt).toUTCString()}</pubDate>`,
        `<description>${escapeXml(itemDescription)}</description>`,
        "</item>",
      ].filter(Boolean).join("");
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${escapeXml(title)}</title>
<description>${escapeXml(description)}</description>
${homeUrl ? `<link>${escapeXml(homeUrl)}</link>` : ""}
<language>zh-cn</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
<generator>Check CX</generator>
<atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" xmlns:atom="http://www.w3.org/2005/Atom" />
${itemsXml}
</channel>
</rss>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    },
  });
}

