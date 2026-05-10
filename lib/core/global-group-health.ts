/**
 * fishxcode 全局分组健康数据源
 */

import "server-only";

import type {
  GlobalGroupHealthErrorReason,
  GlobalGroupHealthItem,
  GlobalGroupHealthSummary,
  GlobalGroupHealthWindow,
} from "../types";
import {logError} from "../utils";
import {getAllSiteSettings} from "./site-settings";

const CACHE_TTL_MS = 60 * 1000;
const DEFAULT_WINDOW: GlobalGroupHealthWindow = "24h";
const WINDOWS: GlobalGroupHealthWindow[] = ["1h", "6h", "12h", "24h", "7d", "15d", "30d"];
const DEFAULT_WINDOWS_SETTING = WINDOWS.join(",");
const WINDOW_TIMEOUT_MS: Record<GlobalGroupHealthWindow, number> = {
  "1h": 10 * 1000,
  "6h": 15 * 1000,
  "12h": 20 * 1000,
  "24h": 25 * 1000,
  "7d": 45 * 1000,
  "15d": 60 * 1000,
  "30d": 90 * 1000,
};
const WINDOW_SECONDS: Record<GlobalGroupHealthWindow, number> = {
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "12h": 12 * 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "15d": 15 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
};
const WINDOW_LABEL: Record<GlobalGroupHealthWindow, string> = {
  "1h": "1 小时",
  "6h": "6 小时",
  "12h": "12 小时",
  "24h": "24 小时",
  "7d": "7 天",
  "15d": "15 天",
  "30d": "30 天",
};

interface GroupHealthApiResponse {
  success?: boolean;
  message?: string;
  data?: unknown;
}

interface GroupHealthApiItem {
  group?: unknown;
  total_count?: unknown;
  success_count?: unknown;
  error_count?: unknown;
  quota?: unknown;
  tokens?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  cache_tokens?: unknown;
  cache_request_count?: unknown;
  avg_use_time?: unknown;
  success_rate?: unknown;
  cache_rate?: unknown;
  cache_request_rate?: unknown;
  avg_cache_tokens?: unknown;
  avg_prompt_tokens?: unknown;
  avg_completion_tokens?: unknown;
  first_seen_at?: unknown;
  last_seen_at?: unknown;
  error_reasons?: unknown;
}

let cache: {
  cacheKey: string;
  expiresAt: number;
  summary: GlobalGroupHealthSummary;
} | null = null;

export async function loadGlobalGroupHealth(options?: {
  forceRefresh?: boolean;
  windows?: GlobalGroupHealthWindow[];
}): Promise<GlobalGroupHealthSummary> {
  const now = Date.now();
  const settings = await getAllSiteSettings();
  const enabled = readSetting(settings, "global_group_health.enabled", "true") === "true";
  const showErrorReasons =
    readSetting(settings, "global_group_health.show_error_reasons", "false") === "true";
  const enabledWindows = parseWindowsSetting(
    readSetting(settings, "global_group_health.windows", DEFAULT_WINDOWS_SETTING)
  );
  const defaultWindow = pickDefaultWindow(enabledWindows);
  const requestedWindows = resolveRequestedWindows(options?.windows, enabledWindows, defaultWindow);
  const shouldUseFullCache =
    requestedWindows.length === enabledWindows.length &&
    requestedWindows.every((window) => enabledWindows.includes(window));

  if (!enabled) {
    return unavailableSummary("全局分组监控未启用", false, showErrorReasons, enabledWindows, defaultWindow);
  }

  const baseUrl = readSetting(settings, "global_group_health.newapi_base_url", process.env.NEWAPI_BASE_URL);
  const accessToken = readSetting(settings, "global_group_health.newapi_access_token", process.env.NEWAPI_ACCESS_TOKEN);
  if (!baseUrl || !accessToken) {
    return unavailableSummary("未配置 fishxcode 分组健康数据源", true, showErrorReasons, enabledWindows, defaultWindow);
  }

  const userId = readSetting(settings, "global_group_health.newapi_user_id", process.env.NEWAPI_USER_ID);
  const cacheKey = createCacheKey(enabledWindows, baseUrl, accessToken, userId, showErrorReasons);
  if (
    !options?.forceRefresh &&
    shouldUseFullCache &&
    cache &&
    cache.cacheKey === cacheKey &&
    now < cache.expiresAt
  ) {
    return cache.summary;
  }

  const summary = await fetchGlobalGroupHealth(
    baseUrl,
    accessToken,
    userId,
    requestedWindows,
    showErrorReasons,
    enabledWindows,
    defaultWindow
  );
  if (shouldUseFullCache) {
    cache = {
      summary,
      cacheKey,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
  }
  return summary;
}

async function fetchGlobalGroupHealth(
  baseUrl: string,
  accessToken: string,
  userId: string,
  requestedWindows: GlobalGroupHealthWindow[],
  showErrorReasons: boolean,
  enabledWindows: GlobalGroupHealthWindow[],
  defaultWindow: GlobalGroupHealthWindow
): Promise<GlobalGroupHealthSummary> {
  const settled = await Promise.all(
    requestedWindows.map(async (window) => {
      try {
        const items = await fetchGlobalGroupHealthWindow(baseUrl, accessToken, userId, window);
        return {window, items, ok: true as const};
      } catch (error) {
        logError(`读取 fishxcode 分组健康失败(${window})`, error);
        return {window, items: [], ok: false as const};
      }
    })
  );
  const failedWindows = settled
    .filter((entry) => !entry.ok)
    .map((entry) => entry.window);
  const itemsByWindow = Object.fromEntries(
    settled.map((entry) => [entry.window, entry.items])
  ) as Record<GlobalGroupHealthWindow, GlobalGroupHealthItem[]>;

  if (failedWindows.length === requestedWindows.length) {
    return unavailableSummary("fishxcode 分组健康读取失败", true, showErrorReasons, enabledWindows, defaultWindow);
  }

  const emptyItemsByWindow = createEmptyItemsByWindow();
  return {
    available: true,
    enabled: true,
    showErrorReasons,
    updatedAt: new Date().toISOString(),
    defaultWindow,
    windows: enabledWindows,
    itemsByWindow: {...emptyItemsByWindow, ...itemsByWindow},
    message:
      failedWindows.length > 0
        ? `部分历史窗口读取失败：${failedWindows.map((window) => WINDOW_LABEL[window]).join("、")}`
        : undefined,
  };
}

async function fetchGlobalGroupHealthWindow(
  baseUrl: string,
  accessToken: string,
  userId: string,
  window: GlobalGroupHealthWindow
): Promise<GlobalGroupHealthItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WINDOW_TIMEOUT_MS[window]);

  try {
    const response = await fetch(buildGroupHealthUrl(baseUrl, userId, window), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`fishxcode 分组健康接口返回 ${response.status}`);
    }

    const body = (await response.json()) as GroupHealthApiResponse;
    if (body.success !== true || !Array.isArray(body.data)) {
      throw new Error(body.message || "fishxcode 分组健康响应无效");
    }

    return body.data
      .map((item) => normalizeGroupHealthItem(item))
      .filter((item): item is GlobalGroupHealthItem => Boolean(item))
      .sort((a, b) => a.successRate - b.successRate || b.totalCount - a.totalCount);
  } finally {
    clearTimeout(timeout);
  }
}

function buildGroupHealthUrl(
  baseUrl: string,
  userId: string,
  window: GlobalGroupHealthWindow
): string {
  const url = new URL("/api/log/group_health", ensureTrailingSlash(baseUrl));
  const nowSeconds = Math.floor(Date.now() / 1000);
  url.searchParams.set("token_name", "");
  url.searchParams.set("model_name", "");
  url.searchParams.set("start_timestamp", String(nowSeconds - WINDOW_SECONDS[window]));
  url.searchParams.set("end_timestamp", String(nowSeconds));
  url.searchParams.set("group", "");
  url.searchParams.set("request_id", "");
  url.searchParams.set("error_message", "");
  url.searchParams.set("status_code", "");
  url.searchParams.set("subscription_id", "");
  url.searchParams.set("subscription_plan_id", "");
  url.searchParams.set("user_id", userId);
  url.searchParams.set("username", "");
  url.searchParams.set("channel", "");
  url.searchParams.set("include_token_stats", "false");
  return url.toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeGroupHealthItem(value: unknown): GlobalGroupHealthItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const item = value as GroupHealthApiItem;
  const group = typeof item.group === "string" ? item.group : "";
  const successRate = toNumber(item.success_rate);
  const firstSeenAt = toIsoTimestamp(item.first_seen_at);
  const lastSeenAt = toIsoTimestamp(item.last_seen_at);
  if (!group || successRate === null || !firstSeenAt || !lastSeenAt) {
    return null;
  }

  return {
    group,
    status: mapSuccessRateToStatus(successRate),
    totalCount: toNumber(item.total_count) ?? 0,
    successCount: toNumber(item.success_count) ?? 0,
    errorCount: toNumber(item.error_count) ?? 0,
    quota: toNumber(item.quota) ?? 0,
    tokens: toNumber(item.tokens) ?? 0,
    promptTokens: toNumber(item.prompt_tokens) ?? 0,
    completionTokens: toNumber(item.completion_tokens) ?? 0,
    cacheTokens: toNumber(item.cache_tokens) ?? 0,
    cacheRequestCount: toNumber(item.cache_request_count) ?? 0,
    avgUseTime: toNumber(item.avg_use_time) ?? 0,
    successRate,
    cacheRate: toNumber(item.cache_rate) ?? 0,
    cacheRequestRate: toNumber(item.cache_request_rate) ?? 0,
    avgCacheTokens: toNumber(item.avg_cache_tokens) ?? 0,
    avgPromptTokens: toNumber(item.avg_prompt_tokens) ?? 0,
    avgCompletionTokens: toNumber(item.avg_completion_tokens) ?? 0,
    firstSeenAt,
    lastSeenAt,
    errorReasons: normalizeErrorReasons(item.error_reasons),
  };
}

function normalizeErrorReasons(value: unknown): GlobalGroupHealthErrorReason[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((reason) => {
      if (!isRecord(reason)) {
        return null;
      }
      const content = typeof reason.content === "string" ? reason.content : "";
      const count = toNumber(reason.count) ?? 0;
      const statusCode =
        typeof reason.status_code === "string" ? reason.status_code : String(reason.status_code ?? "");
      if (!content) {
        return null;
      }
      return {content, count, statusCode};
    })
    .filter((reason): reason is GlobalGroupHealthErrorReason => Boolean(reason))
    .slice(0, 3);
}

function mapSuccessRateToStatus(successRate: number): GlobalGroupHealthItem["status"] {
  if (successRate >= 80) {
    return "operational";
  }
  if (successRate >= 70) {
    return "degraded";
  }
  return "failed";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toIsoTimestamp(value: unknown): string | null {
  const seconds = toNumber(value);
  if (seconds === null) {
    return null;
  }
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readSetting(
  settings: Record<string, string>,
  key: string,
  fallback: string | undefined
): string {
  return (settings[key] ?? fallback ?? "").trim();
}

function parseWindowsSetting(value: string): GlobalGroupHealthWindow[] {
  const seen = new Set<GlobalGroupHealthWindow>();
  for (const rawWindow of value.split(",")) {
    const window = rawWindow.trim();
    if (isGlobalGroupHealthWindow(window)) {
      seen.add(window);
    }
  }
  return seen.size > 0 ? [...seen] : WINDOWS;
}

function resolveRequestedWindows(
  requestedWindows: GlobalGroupHealthWindow[] | undefined,
  enabledWindows: GlobalGroupHealthWindow[],
  defaultWindow: GlobalGroupHealthWindow
): GlobalGroupHealthWindow[] {
  if (!requestedWindows) {
    return enabledWindows;
  }
  const allowed = requestedWindows.filter((window) => enabledWindows.includes(window));
  return allowed.length > 0 ? allowed : [defaultWindow];
}

function pickDefaultWindow(windows: GlobalGroupHealthWindow[]): GlobalGroupHealthWindow {
  return windows.includes(DEFAULT_WINDOW) ? DEFAULT_WINDOW : windows[0] ?? DEFAULT_WINDOW;
}

function isGlobalGroupHealthWindow(value: string): value is GlobalGroupHealthWindow {
  return WINDOWS.includes(value as GlobalGroupHealthWindow);
}

function createCacheKey(
  windows: GlobalGroupHealthWindow[],
  baseUrl: string,
  accessToken: string,
  userId: string,
  showErrorReasons: boolean
): string {
  return JSON.stringify({windows, baseUrl, accessToken, userId, showErrorReasons});
}

function unavailableSummary(
  message: string,
  enabled: boolean = true,
  showErrorReasons: boolean = false,
  windows: GlobalGroupHealthWindow[] = WINDOWS,
  defaultWindow: GlobalGroupHealthWindow = DEFAULT_WINDOW
): GlobalGroupHealthSummary {
  return {
    available: false,
    enabled,
    showErrorReasons,
    updatedAt: null,
    defaultWindow,
    windows,
    itemsByWindow: createEmptyItemsByWindow(),
    message,
  };
}

function createEmptyItemsByWindow(): Record<GlobalGroupHealthWindow, GlobalGroupHealthItem[]> {
  return {
    "1h": [],
    "6h": [],
    "12h": [],
    "24h": [],
    "7d": [],
    "15d": [],
    "30d": [],
  };
}
