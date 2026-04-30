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
const REQUEST_TIMEOUT_MS = 10 * 1000;
const DEFAULT_WINDOW: GlobalGroupHealthWindow = "24h";
const WINDOWS: GlobalGroupHealthWindow[] = ["1h", "6h", "12h", "24h"];
const WINDOW_SECONDS: Record<GlobalGroupHealthWindow, number> = {
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "12h": 12 * 60 * 60,
  "24h": 24 * 60 * 60,
};
const WINDOW_LABEL: Record<GlobalGroupHealthWindow, string> = {
  "1h": "1 小时",
  "6h": "6 小时",
  "12h": "12 小时",
  "24h": "24 小时",
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
  avg_use_time?: unknown;
  success_rate?: unknown;
  first_seen_at?: unknown;
  last_seen_at?: unknown;
  error_reasons?: unknown;
}

let cache: {
  expiresAt: number;
  summary: GlobalGroupHealthSummary;
} | null = null;

export async function loadGlobalGroupHealth(options?: {
  forceRefresh?: boolean;
}): Promise<GlobalGroupHealthSummary> {
  const now = Date.now();
  if (!options?.forceRefresh && cache && now < cache.expiresAt) {
    return cache.summary;
  }

  const settings = await getAllSiteSettings();
  const enabled = readSetting(settings, "global_group_health.enabled", "true") === "true";
  if (!enabled) {
    return unavailableSummary("全局分组监控未启用", false);
  }

  const baseUrl = readSetting(settings, "global_group_health.newapi_base_url", process.env.NEWAPI_BASE_URL);
  const accessToken = readSetting(settings, "global_group_health.newapi_access_token", process.env.NEWAPI_ACCESS_TOKEN);
  if (!baseUrl || !accessToken) {
    return unavailableSummary("未配置 fishxcode 分组健康数据源");
  }

  const userId = readSetting(settings, "global_group_health.newapi_user_id", process.env.NEWAPI_USER_ID);
  const summary = await fetchGlobalGroupHealth(baseUrl, accessToken, userId);
  cache = {
    summary,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return summary;
}

async function fetchGlobalGroupHealth(
  baseUrl: string,
  accessToken: string,
  userId: string
): Promise<GlobalGroupHealthSummary> {
  const settled = await Promise.all(
    WINDOWS.map(async (window) => {
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

  if (failedWindows.length === WINDOWS.length) {
    return unavailableSummary("fishxcode 分组健康读取失败");
  }

  return {
    available: true,
    enabled: true,
    updatedAt: new Date().toISOString(),
    defaultWindow: DEFAULT_WINDOW,
    windows: WINDOWS,
    itemsByWindow,
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
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
    avgUseTime: toNumber(item.avg_use_time) ?? 0,
    successRate,
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

function unavailableSummary(
  message: string,
  enabled: boolean = true
): GlobalGroupHealthSummary {
  return {
    available: false,
    enabled,
    updatedAt: null,
    defaultWindow: DEFAULT_WINDOW,
    windows: WINDOWS,
    itemsByWindow: {
      "1h": [],
      "6h": [],
      "12h": [],
      "24h": [],
    },
    message,
  };
}
