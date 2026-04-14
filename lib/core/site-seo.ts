import "server-only";

import {getSiteSettingSync, refreshSiteSettings} from "@/lib/core/site-settings";

const DEFAULT_SITE_TITLE = "Check CX - AI 模型健康监控";
const DEFAULT_SITE_DESCRIPTION = "实时检测 OpenAI / Gemini / Anthropic 对话接口的可用性与延迟";
const DEFAULT_SITE_KEYWORDS = [
  "AI 状态监控",
  "OpenAI 状态",
  "Gemini 状态",
  "Anthropic 状态",
  "API uptime",
  "status page",
];

function normalizeSiteUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  try {
    const url = value.startsWith("http://") || value.startsWith("https://")
      ? new URL(value)
      : new URL(`https://${value}`);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function getEnvSiteUrl(): string | null {
  const envCandidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ];

  for (const candidate of envCandidates) {
    if (!candidate) continue;
    const normalized = normalizeSiteUrl(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function parseKeywords(raw: string): string[] {
  const items = raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)) : DEFAULT_SITE_KEYWORDS;
}

export interface SiteSeoConfig {
  title: string;
  description: string;
  keywords: string[];
  faviconUrl: string;
  logoUrl: string;
  githubUrl: string;
  siteUrl: string | null;
}

export async function getSiteSeoConfig(): Promise<SiteSeoConfig> {
  await refreshSiteSettings();

  const title = getSiteSettingSync("site.title", DEFAULT_SITE_TITLE);
  const description = getSiteSettingSync("site.description", DEFAULT_SITE_DESCRIPTION);
  const faviconUrl = getSiteSettingSync("site.favicon_url", "/favicon.png");
  const logoUrl = getSiteSettingSync("site.logo_url", "/favicon.png");
  const githubUrl = getSiteSettingSync("site.github_url", "");
  const siteUrl = normalizeSiteUrl(getSiteSettingSync("site.url", "")) ?? getEnvSiteUrl();
  const keywords = parseKeywords(getSiteSettingSync("site.keywords", DEFAULT_SITE_KEYWORDS.join(", ")));

  return {
    title,
    description,
    keywords,
    faviconUrl,
    logoUrl,
    githubUrl,
    siteUrl,
  };
}

export function toAbsoluteUrl(path: string, siteUrl: string | null): string | null {
  if (!siteUrl) return null;
  return new URL(path, `${siteUrl}/`).toString();
}

