import {NextResponse} from "next/server";
import {STATUS_META} from "@/lib/core/status";
import {getSiteSeoConfig, toAbsoluteUrl} from "@/lib/core/site-seo";
import {parsePublicScope, resolvePublicScope} from "@/lib/core/public-scope";
import {scopeQuery} from "@/lib/core/public-metadata";
import {createAdminClient} from "@/lib/supabase/admin";
import {getModelPath} from "@/lib/utils/model-slug";
import type {HealthStatus} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
interface StatusEvent {event_id: string; model_name: string; status: string; previous_status: string; checked_at: string}

export async function GET(request: Request) {
  const scope = parsePublicScope(new URL(request.url).searchParams);
  if (!scope) return new NextResponse("无效范围", {status: 400});
  try {
    const resolved = await resolvePublicScope(scope);
    if (!resolved) return new NextResponse("未找到", {status: 404});
    const site = await getSiteSeoConfig();
    const {data, error} = await createAdminClient().rpc("get_public_status_events", {
      p_models: scope.scope === "all" || scope.scope === "group" ? null : resolved.modelNames,
      p_group: resolved.groupName, p_limit: 30,
    });
    if (error) throw new Error("状态事件读取失败");
    const absolute = (path: string) => toAbsoluteUrl(path, site.siteUrl) ?? path;
    const feedUrl = absolute(`/rss.xml?${scopeQuery(resolved.scope)}`);
    const items = ((data ?? []) as StatusEvent[]).map((event) => {
      const current = STATUS_META[event.status as HealthStatus];
      const previous = STATUS_META[event.previous_status as HealthStatus];
      if (!current || !previous || !Number.isFinite(Date.parse(event.checked_at))) return "";
      const title = `${event.model_name} · ${previous.label} → ${current.label}`;
      const link = absolute(scope.scope === "group" ? resolved.path : getModelPath(event.model_name));
      return `<item><title>${escapeXml(title)}</title><link>${escapeXml(link)}</link><guid isPermaLink="false">${escapeXml(`check-cx:status:${event.event_id}`)}</guid><pubDate>${new Date(event.checked_at).toUTCString()}</pubDate><description>${escapeXml(title)}</description></item>`;
    }).join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${escapeXml(`${resolved.title} · ${site.title}`)}</title><description>${escapeXml(site.description)}</description><link>${escapeXml(absolute(resolved.path))}</link><language>zh-cn</language><atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${items}</channel></rss>`;
    return new NextResponse(xml, {headers: {"Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=300"}});
  } catch { return new NextResponse("状态订阅暂不可用", {status: 503, headers: {"Cache-Control": "no-store"}}); }
}
