import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/utils";

/**
 * Worker 触发日志
 *
 * 记录外部调度（CF Worker Cron 等）对 /api/internal/checks/run 的每次调用，
 * 用于在后台确认定时触发是否按预期到达服务端、耗时与结果。
 */

interface WorkerTriggerLogInsert {
  attemptId: string;
  triggerType: "worker" | "token";
  workerEvent: "scheduled" | "fetch" | null;
  tokenName: string | null;
}

/** 插入一条触发日志，返回日志 ID（插入失败时返回 null，不阻塞检测主流程） */
export async function createTriggerLog(
  input: WorkerTriggerLogInsert
): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("worker_trigger_logs")
      .insert({
        attempt_id: input.attemptId,
        trigger_type: input.triggerType,
        worker_event: input.workerEvent,
        token_name: input.tokenName,
        status: "running",
      })
      .select("id")
      .single();

    if (error || !data) {
      logError("写入触发日志失败", error ?? new Error("未返回日志 ID"));
      return null;
    }
    return data.id as string;
  } catch (err) {
    logError("写入触发日志异常", err);
    return null;
  }
}

/** 检测执行完成后回填结果 */
export async function finishTriggerLog(
  logId: string | null,
  result: {
    status: "success" | "failed" | "aborted";
    durationMs: number | null;
    configCount: number | null;
    issueCount: number | null;
    message?: string | null;
  }
): Promise<void> {
  if (!logId) return;
  try {
    const admin = createAdminClient();
    await admin
      .from("worker_trigger_logs")
      .update({
        status: result.status,
        duration_ms: result.durationMs,
        config_count: result.configCount,
        issue_count: result.issueCount,
        message: result.message ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", logId);
  } catch (err) {
    logError("回填触发日志失败", err);
  }
}
