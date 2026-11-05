import "server-only";

import {createAdminClient} from "@/lib/supabase/admin";

interface HeartbeatInput {
  ok: boolean;
  httpStatus: number;
  durationMs: number;
  message?: string | null;
}

/** 记录一次调度心跳；失败不能影响 pump 主流程。 */
export async function recordPumpHeartbeat(input: HeartbeatInput): Promise<void> {
  try {
    const {error} = await createAdminClient({requestTimeoutMs: 5_000})
      .rpc("record_pump_heartbeat", {
        p_ok: input.ok,
        p_http_status: input.httpStatus,
        p_duration_ms: input.durationMs,
        p_message: input.message ?? null,
      });
    if (error) console.error("[pump-heartbeat] 记录心跳失败", error.code);
  } catch (error) {
    console.error("[pump-heartbeat] 记录心跳异常", error instanceof Error ? error.message : "未知错误");
  }
}
