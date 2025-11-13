/**
 * 健康检查相关类型定义
 */

import type { ProviderType } from "./provider";

/**
 * Provider 健康状态
 */
export type HealthStatus = "operational" | "degraded" | "failed";

/**
 * 单次检查结果
 */
export interface CheckResult {
  id: string; // config_id from database
  name: string;
  type: ProviderType;
  endpoint: string;
  model: string;
  status: HealthStatus;
  latencyMs: number | null;
  checkedAt: string; // ISO 8601 timestamp
  message: string;
}
