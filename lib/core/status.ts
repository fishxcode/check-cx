import type { HealthStatus, ProviderType } from "../types";

export const STATUS_META: Record<
  HealthStatus,
  {
    label: string;
    description: string;
    badge: "success" | "warning" | "danger";
    dot: string;
  }
> = {
  operational: {
    label: "正常",
    description: "请求响应如常",
    badge: "success",
    dot: "bg-emerald-500",
  },
  degraded: {
    label: "延迟",
    description: "响应成功但耗时升高",
    badge: "warning",
    dot: "bg-amber-500",
  },
  failed: {
    label: "异常",
    description: "请求失败或超时",
    badge: "danger",
    dot: "bg-rose-500",
  },
};

export const PROVIDER_LABEL: Record<ProviderType, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic",
};
