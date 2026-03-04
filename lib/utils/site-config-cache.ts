/**
 * 前端站点配置缓存
 * 用于前台页面动态加载和更新配置
 */

export interface SiteConfig {
  title: string;
  description: string;
  logoUrl: string;
  faviconUrl: string;
}

let cachedConfig: SiteConfig | null = null;
let lastFetchedAt = 0;
const CACHE_TTL_MS = 30 * 1000; // 30 秒缓存（改短以更快反应后台变更）

export async function getSiteConfig(forceRefresh = false): Promise<SiteConfig> {
  const now = Date.now();

  // 检查缓存是否有效
  if (!forceRefresh && cachedConfig && now - lastFetchedAt < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const response = await fetch("/api/site-config", {
      cache: "no-store", // 禁用浏览器缓存，保证每次调用都向服务器验证
      headers: {
        "Cache-Control": "no-cache", // 告知浏览器不使用缓存
      },
    });

    if (response.ok) {
      const config = (await response.json()) as SiteConfig;
      cachedConfig = config;
      lastFetchedAt = now;
      return config;
    }
  } catch (error) {
    console.error("[site-config] 获取配置失败:", error);
    if (cachedConfig) {
      return cachedConfig;
    }
  }

  // 返回默认值
  return {
    title: "Check CX - AI 模型健康监控",
    description: "实时检测 OpenAI / Gemini / Anthropic 对话接口的可用性与延迟",
    logoUrl: "/favicon.png",
    faviconUrl: "/favicon.png",
  };
}

/**
 * 清除缓存，强制下次重新获取
 */
export function clearSiteConfigCache(): void {
  cachedConfig = null;
  lastFetchedAt = 0;
}
