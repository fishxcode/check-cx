/**
 * OpenAI Provider 健康检查（使用官方 openai SDK）
 */

import OpenAI from "openai";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";

import type { CheckResult, HealthStatus, ProviderConfig } from "../types";
import { DEFAULT_ENDPOINTS } from "../types";
import { measureEndpointPing } from "./endpoint-ping";

/**
 * 默认超时时间 (毫秒)
 * 与其他 Provider 保持一致
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 性能降级阈值 (毫秒)
 * 与其他 Provider 保持一致
 */
const DEGRADED_THRESHOLD_MS = 6_000;

/**
 * 扩展 globalThis 以在 dev 热更时复用 OpenAI 客户端
 */
declare global {
  var __CHECK_CX_OPENAI_CLIENTS__:
    | Map<string, OpenAI>
    | undefined;
}

/**
 * OpenAI 客户端全局缓存
 * key = baseURL + apiKey，用于复用连接和内部缓存
 */
const openAIClientCache: Map<string, OpenAI> =
  globalThis.__CHECK_CX_OPENAI_CLIENTS__ ??
  (globalThis.__CHECK_CX_OPENAI_CLIENTS__ = new Map<string, OpenAI>());

type ReasoningEffortValue = NonNullable<
  ChatCompletionCreateParamsStreaming["reasoning_effort"]
>;

const EFFORT_ALIAS_MAP: Record<string, ReasoningEffortValue> = {
  mini: "minimal",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
};

// 部分 OpenAI 兼容网关（例如 PackyAPI）要求显式传递 reasoning_effort，
// 因此在未指定指令时为常见的推理模型提供一个安全的默认值。
const REASONING_MODEL_HINTS = [
  /codex/i,
  /\bgpt-5/i,
  /\bo[1-9]/i,
  /deepseek-r1/i,
  /qwq/i,
];

function resolveModelPreferences(model: string): {
  requestModel: string;
  reasoningEffort?: ReasoningEffortValue;
} {
  const trimmed = model.trim();
  if (!trimmed) {
    return { requestModel: model };
  }

  const directiveMatch = trimmed.match(
    /^(.*?)[@#](mini|minimal|low|medium|high)$/i
  );
  if (directiveMatch) {
    const [, base, effortRaw] = directiveMatch;
    const normalizedBase = base.trim() || trimmed;
    const normalizedEffort =
      EFFORT_ALIAS_MAP[
        effortRaw.toLowerCase() as keyof typeof EFFORT_ALIAS_MAP
      ];
    return {
      requestModel: normalizedBase,
      reasoningEffort: normalizedEffort,
    };
  }

  if (REASONING_MODEL_HINTS.some((regex) => regex.test(trimmed))) {
    return { requestModel: trimmed, reasoningEffort: "medium" };
  }

  return { requestModel: trimmed };
}

/**
 * 从配置的 endpoint 推导 openai SDK 的 baseURL
 *
 * - 支持默认的 https://api.openai.com/v1/chat/completions
 * - 支持自定义 /v1/chat/completions 或 Azure 兼容的 /chat/completions 路径
 */
function deriveOpenAIBaseURL(endpoint: string | null | undefined): string {
  const raw = endpoint || DEFAULT_ENDPOINTS.openai;

  // 去掉查询参数
  const [withoutQuery] = raw.split("?");
  let base = withoutQuery;

  // 去掉 /chat/completions 这类具体路径，保留前缀
  const chatIndex = base.indexOf("/chat/completions");
  if (chatIndex !== -1) {
    base = base.slice(0, chatIndex);
  }

  // 对于标准 OpenAI，确保以 /v1 结尾
  const v1Index = base.indexOf("/v1");
  if (v1Index !== -1) {
    base = base.slice(0, v1Index + "/v1".length);
  } else if (base.includes("api.openai.com")) {
    // 若未显式包含 /v1，但域名是 api.openai.com，则补上 /v1
    base = `${base.replace(/\/$/, "")}/v1`;
  }

  return base;
}

/**
 * 获取（或创建）复用的 OpenAI 客户端
 */
function getOpenAIClient(config: ProviderConfig): OpenAI {
  const baseURL = deriveOpenAIBaseURL(config.endpoint);
  const cacheKey = `${baseURL}::${config.apiKey}`;

  const cached = openAIClientCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL,
    // 某些代理/网关（例如启用了 Cloudflare「封锁 AI 爬虫」规则的站点）
    // 会对默认的 OpenAI User-Agent（如 `OpenAI/TS ...`）返回 402 Your request was blocked.
    // 这里统一改成一个普通应用的 UA，避免被误判为爬虫。
    defaultHeaders: {
      "User-Agent": "check-cx/0.1.0",
    },
  });

  openAIClientCache.set(cacheKey, client);
  return client;
}

/**
 * 检查 OpenAI API 健康状态（流式）
 */
export async function checkOpenAI(
  config: ProviderConfig
): Promise<CheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  const displayEndpoint = config.endpoint || DEFAULT_ENDPOINTS.openai;
  const pingPromise = measureEndpointPing(displayEndpoint);
  const { requestModel, reasoningEffort } = resolveModelPreferences(
    config.model
  );

  try {
    const client = getOpenAIClient(config);

    // 使用 Chat Completions 流式接口进行最小请求
    const requestPayload: ChatCompletionCreateParamsStreaming = {
      model: requestModel,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
      temperature: 0,
      stream: true,
    };

    if (reasoningEffort) {
      requestPayload.reasoning_effort = reasoningEffort;
    }

    const stream = await client.chat.completions.create(requestPayload, {
      signal: controller.signal,
    });

    // 读取完整的流式响应（内容本身不重要，只要能成功流式返回即可）
    for await (const chunk of stream) {
      // 这里不需要组装完整内容，仅保证流可读
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      chunk.choices?.[0]?.delta?.content;
    }

    const latencyMs = Date.now() - startedAt;
    const status: HealthStatus =
      latencyMs <= DEGRADED_THRESHOLD_MS ? "operational" : "degraded";

    const message =
      status === "degraded"
        ? `响应成功但耗时 ${latencyMs}ms`
        : `流式响应正常 (${latencyMs}ms)`;

    const pingLatencyMs = await pingPromise;
    return {
      id: config.id,
      name: config.name,
      type: config.type,
      endpoint: displayEndpoint,
      model: config.model,
      status,
      latencyMs,
      pingLatencyMs,
      checkedAt: new Date().toISOString(),
      message,
    };
  } catch (error) {
    const err = error as Error & { name?: string };
    const message =
      err?.name === "AbortError" ? "请求超时" : err?.message || "未知错误";

    const pingLatencyMs = await pingPromise;
    return {
      id: config.id,
      name: config.name,
      type: config.type,
      endpoint: displayEndpoint,
      model: config.model,
      status: "failed",
      latencyMs: null,
      pingLatencyMs,
      checkedAt: new Date().toISOString(),
      message,
    };
  } finally {
    clearTimeout(timeout);
  }
}
