import { NextResponse } from "next/server";
import { getAllSiteSettings } from "@/lib/core/site-settings";

function buildEtag(payload: unknown): string {
  const raw = JSON.stringify(payload);
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
  }
  return `W/"${(hash >>> 0).toString(16)}"`;
}

/**
 * 公开端点：获取所有前台可用的站点配置
 * 用于前端动态读取 title、description、logo_url 等
 */
export async function GET() {
  try {
    const settings = await getAllSiteSettings();

    // 筛选并返回前台需要的配置
    const siteConfig = {
      title: settings["site.title"] || "Check CX - AI 模型健康监控",
      description:
        settings["site.description"] ||
        "实时检测 OpenAI / Gemini / Anthropic 对话接口的可用性与延迟",
      logoUrl: settings["site.logo_url"] || "/favicon.png",
      faviconUrl: settings["site.favicon_url"] || "/favicon.png",
      githubUrl: settings["site.github_url"] || "",
    };

    return NextResponse.json(siteConfig, {
      headers: {
        "Cache-Control": "public, max-age=60", // 改为 1 分钟缓存，更及时更新
        "ETag": buildEtag(siteConfig), // ETag 必须是 ASCII，避免中文值触发 ByteString 异常
      },
    });
  } catch (error) {
    console.error("[site-config] 获取配置失败:", error);
    // 返回默认值
    return NextResponse.json(
      {
        title: "Check CX - AI 模型健康监控",
        description:
          "实时检测 OpenAI / Gemini / Anthropic 对话接口的可用性与延迟",
        logoUrl: "/favicon.png",
        faviconUrl: "/favicon.png",
      },
      { status: 500 }
    );
  }
}
