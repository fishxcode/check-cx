/**
 * 配置审计日志写入工具
 *
 * 供 configs 路由在 PUT/PATCH/DELETE/lock/unlock 等写操作后调用，
 * 将变更记录写入 config_audit_log 表。写入失败仅记录日志，绝不抛出，
 * 以免影响主业务流程。
 */

import "server-only";
import { createAdminClient } from "../supabase/admin";
import { logError } from "../utils";
import type { AuditAction } from "../types/database";

/** 敏感字段，写入审计日志前必须剔除 */
const SENSITIVE_KEYS = ["api_key"] as const;

export interface AuditLogInput {
  configId: string;
  action: AuditAction | string;
  actorId: string;
  actorEmail: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  changedFields?: string[] | null;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** 从数据对象中剔除敏感字段（api_key 等），返回浅拷贝 */
function stripSensitive(
  data: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!data) return null;
  const cleaned: Record<string, unknown> = { ...data };
  for (const key of SENSITIVE_KEYS) delete cleaned[key];
  return cleaned;
}

/**
 * 写入一条审计日志。失败时静默记录，不抛出异常。
 */
export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("config_audit_log").insert({
      config_id: input.configId,
      action: input.action,
      actor_id: input.actorId,
      actor_email: input.actorEmail,
      before_data: stripSensitive(input.beforeData),
      after_data: stripSensitive(input.afterData),
      changed_fields: input.changedFields ?? null,
      reason: input.reason ?? null,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    });
    if (error) logError("writeAuditLog", error);
  } catch (err) {
    logError("writeAuditLog", err);
  }
}

/**
 * 对比前后数据，返回值发生变化的键名列表（忽略 api_key）。
 * 使用 JSON 序列化做深比较，适配 jsonb 等复杂字段。
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed: string[] = [];
  for (const key of keys) {
    if ((SENSITIVE_KEYS as readonly string[]).includes(key)) continue;
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) {
      changed.push(key);
    }
  }
  return changed;
}
