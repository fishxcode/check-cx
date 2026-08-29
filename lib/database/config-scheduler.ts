import "server-only";
import { createAdminClient } from "../supabase/admin";
import { logError } from "../utils";

/**
 * 更新配置的下次检查时间
 * @param configId 配置 ID
 * @param nextCheckAt ISO 时间戳字符串
 */
export async function updateNextCheckAt(configId: string, nextCheckAt: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("check_configs").update({ next_check_at: nextCheckAt }).eq("id", configId);
    if (error) {
      logError(`updateNextCheckAt(${configId})`, error);
    }
  } catch (err) {
    logError(`updateNextCheckAt(${configId})`, err);
  }
}

/**
 * 判断配置是否处于暂停状态
 * @param pausedUntil 暂停截止时间戳字符串
 * @param now 当前时间戳（毫秒），默认为 Date.now()
 * @returns 是否暂停中
 */
export function isConfigPaused(pausedUntil: string | null | undefined, now: number = Date.now()): boolean {
  if (!pausedUntil) return false;
  const pausedUntilTime = new Date(pausedUntil).getTime();
  return !isNaN(pausedUntilTime) && now < pausedUntilTime;
}

/**
 * 判断配置是否到期需要检查
 * @param nextCheckAt 下次检查时间戳字符串
 * @param now 当前时间戳（毫秒），默认为 Date.now()
 * @returns 是否到期
 */
export function isConfigDue(nextCheckAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!nextCheckAt) return true;
  const nextCheckTime = new Date(nextCheckAt).getTime();
  return isNaN(nextCheckTime) || now >= nextCheckTime;
}
