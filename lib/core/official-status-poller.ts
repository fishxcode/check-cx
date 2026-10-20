/**
 * 官方状态轮询器
 * 独立于 Provider 检查,按固定间隔检查各 Provider 的官方服务状态
 */

import type {OfficialStatusResult, ProviderType} from "../types";
import {checkAllOfficialStatuses} from "../official-status";
import {logError} from "../utils/error-handler";
import {ensurePollerLeadership, isPollerLeader} from "./poller-leadership";

declare global {
  // 缓存所有 Provider 的最新官方状态
  // 需要挂在 globalThis 以跨模块/热重载复用
  var __CHECK_CX_OFFICIAL_STATUS_CACHE__:
    | Map<ProviderType, OfficialStatusResult>
    | undefined;
  // 标记当前是否已有轮询检查在进行，避免并发
  var __checkCxOfficialStatusPolling: boolean | undefined;
}
function getOfficialStatusCache(): Map<ProviderType, OfficialStatusResult> {
  if (!globalThis.__CHECK_CX_OFFICIAL_STATUS_CACHE__) {
    globalThis.__CHECK_CX_OFFICIAL_STATUS_CACHE__ = new Map();
  }
  return globalThis.__CHECK_CX_OFFICIAL_STATUS_CACHE__;
}

function isOfficialStatusPolling(): boolean {
  return globalThis.__checkCxOfficialStatusPolling ?? false;
}

function setOfficialStatusPolling(polling: boolean): void {
  globalThis.__checkCxOfficialStatusPolling = polling;
}

/**
 * 官方状态缓存
 * 使用 Map 存储每个 Provider 的最新官方状态
 */
const officialStatusCache = getOfficialStatusCache();

/**
 * 获取指定 Provider 的官方状态(从缓存)
 * @param type - Provider 类型
 * @returns 官方状态结果,如果未缓存则返回 undefined
 */
export function getOfficialStatus(
  type: ProviderType
): OfficialStatusResult | undefined {
  return officialStatusCache.get(type);
}

/**
 * 获取所有 Provider 的官方状态缓存
 */
export function getAllOfficialStatuses(): Map<
  ProviderType,
  OfficialStatusResult
> {
  return new Map(officialStatusCache);
}

/**
 * 执行一次官方状态检查
 * 更新所有 Provider 的官方状态缓存
 */
export async function runOfficialStatusCheckOnce(): Promise<void> {
  try {
    await ensurePollerLeadership();
  } catch (error) {
    logError("runOfficialStatusCheck.leadership", error);
    return;
  }
  if (!isPollerLeader()) {
    return;
  }
  if (isOfficialStatusPolling()) {
    console.log(
      "[官方状态] 跳过本次检查(上次检查仍在进行中)..."
    );
    return;
  }

  setOfficialStatusPolling(true);
  const startTime = Date.now();

  try {
    console.log("[官方状态] 开始检查官方服务状态...");

    // 获取所有需要检查的 Provider 类型
    const allTypes: ProviderType[] = ["openai", "gemini", "anthropic"];

    // 并发检查所有 Provider 的官方状态
    const results = await checkAllOfficialStatuses(allTypes);

    // 更新缓存
    results.forEach((result, type) => {
      officialStatusCache.set(type, result);
      console.log(
        `[官方状态] ${type}: ${result.status} - ${result.message}`
      );
    });

    const duration = Date.now() - startTime;
    console.log(`[官方状态] 检查完成,耗时 ${duration}ms`);
  } catch (error) {
    logError("runOfficialStatusCheck", error);
    console.error("[官方状态] 检查失败:", error);
  } finally {
    setOfficialStatusPolling(false);
  }
}
