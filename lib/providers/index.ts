/**
 * Provider 检查统一入口
 */

import type { CheckResult, ProviderConfig } from "../types";
import { logError, getErrorMessage } from "../utils";
import { checkOpenAI } from "./openai";
import { checkGemini } from "./gemini";
import { checkAnthropic } from "./anthropic";

/**
 * 检查单个 Provider
 */
async function checkProvider(config: ProviderConfig): Promise<CheckResult> {
  switch (config.type) {
    case "openai":
      return checkOpenAI(config);
    case "gemini":
      return checkGemini(config);
    case "anthropic":
      return checkAnthropic(config);
    default:
      throw new Error(`Unsupported provider: ${config.type satisfies never}`);
  }
}

/**
 * 批量执行 Provider 健康检查
 * @param configs Provider 配置列表
 * @returns 检查结果列表,按名称排序
 */
export async function runProviderChecks(
  configs: ProviderConfig[]
): Promise<CheckResult[]> {
  if (configs.length === 0) {
    return [];
  }

  const results = await Promise.all(
    configs.map(async (config) => {
      try {
        return await checkProvider(config);
      } catch (error) {
        logError(`检查 ${config.name} (${config.type}) 失败`, error);
        return {
          id: config.id,
          name: config.name,
          type: config.type,
          endpoint: config.endpoint,
          model: config.model,
          status: "failed" as const,
          latencyMs: null,
          checkedAt: new Date().toISOString(),
          message: getErrorMessage(error),
        };
      }
    })
  );

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// 导出各 Provider 的检查函数供外部使用
export { checkOpenAI } from "./openai";
export { checkGemini } from "./gemini";
export { checkAnthropic } from "./anthropic";
