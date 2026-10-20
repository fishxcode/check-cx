import {createElement} from "react";
import {ImageResponse} from "next/og";
import {parsePublicScope, resolvePublicScope} from "@/lib/core/public-scope";
import {loadOgFont} from "@/lib/core/og-font";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const scope = parsePublicScope(new URL(request.url).searchParams);
  if (!scope) return new Response("无效范围", {status: 400});
  try {
    const resolved = await resolvePublicScope(scope);
    if (!resolved) return new Response("未找到", {status: 404});
    const title = resolved.title.slice(0, 90);
    const subtitle = "模型健康状态 · 探测统计 · 首字延迟";
    const font = await loadOgFont(`${title}${subtitle}Check CX`);
    return new ImageResponse(createElement("div", {style: {display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: 64, background: "#101b29", color: "#f1f5f9", fontFamily: "PublicSans", fontWeight: 600}},
      createElement("div", {style: {fontSize: 30, color: "#6ee7b7"}}, "Check CX"),
      createElement("div", {style: {fontSize: title.length > 30 ? 48 : 68, lineHeight: 1.3}}, title),
      createElement("div", {style: {fontSize: 27, color: "#a9bacd"}}, subtitle)),
    {width: 1200, height: 630, fonts: [{name: "PublicSans", data: font, weight: 600, style: "normal"}], headers: {"Cache-Control": "public, max-age=300"}});
  } catch { return new Response("分享图暂不可用", {status: 503, headers: {"Cache-Control": "no-store"}}); }
}
