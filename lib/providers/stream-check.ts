/**
 * 流式响应检查通用逻辑
 */

import type { CheckResult, HealthStatus, ProviderConfig } from "../types";
import { extractMessage } from "../utils";

/**
 * 默认超时时间 (毫秒)
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 性能降级阈值 (毫秒)
 */
const DEGRADED_THRESHOLD_MS = 6_000;

/**
 * 流式响应解析器类型
 */
export type StreamParser = (
  reader: ReadableStreamDefaultReader<Uint8Array>
) => Promise<string>;

/**
 * 流式检查参数
 */
export interface StreamCheckParams {
  url: string;
  displayEndpoint?: string;
  init: RequestInit;
  parseStream: StreamParser;
}

/**
 * 运行流式检查
 */
export async function runStreamCheck(
  config: ProviderConfig,
  params: StreamCheckParams
): Promise<CheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(params.url, {
      method: "POST",
      signal: controller.signal,
      ...params.init,
    });

    if (!response.ok) {
      const latencyMs = Date.now() - startedAt;
      const errorBody = await response.text();
      const message = extractMessage(errorBody) || `HTTP ${response.status}`;

      return {
        id: config.id,
        name: config.name,
        type: config.type,
        endpoint: params.displayEndpoint || params.url,
        model: config.model,
        status: "failed",
        latencyMs,
        checkedAt: new Date().toISOString(),
        message,
      };
    }

    if (!response.body) {
      throw new Error("响应体为空");
    }

    const reader = response.body.getReader();

    // 解析流式响应
    await params.parseStream(reader);

    const latencyMs = Date.now() - startedAt;
    const status: HealthStatus =
      latencyMs <= DEGRADED_THRESHOLD_MS ? "operational" : "degraded";

    const message =
      status === "degraded"
        ? `响应成功但耗时 ${latencyMs}ms`
        : `流式响应正常 (${latencyMs}ms)`;

    return {
      id: config.id,
      name: config.name,
      type: config.type,
      endpoint: params.displayEndpoint || params.url,
      model: config.model,
      status,
      latencyMs,
      checkedAt: new Date().toISOString(),
      message,
    };
  } catch (error) {
    const err = error as Error & { name?: string };
    const message =
      err?.name === "AbortError" ? "请求超时" : err?.message || "未知错误";
    return {
      id: config.id,
      name: config.name,
      type: config.type,
      endpoint: params.displayEndpoint || params.url,
      model: config.model,
      status: "failed",
      latencyMs: null,
      checkedAt: new Date().toISOString(),
      message,
    };
  } finally {
    clearTimeout(timeout);
  }
}
