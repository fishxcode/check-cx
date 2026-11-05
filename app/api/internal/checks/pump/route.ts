import {NextResponse} from "next/server";

import {runCheckQueuePump} from "@/lib/core/check-queue-pump";
import {recordPumpHeartbeat} from "@/lib/database/pump-heartbeats";
import {touchSchedulerToken, verifySchedulerToken} from "@/lib/database/scheduler-tokens";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const startedAt = Date.now();
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const tokenRecord = await verifySchedulerToken(token, {requestTimeoutMs: 5_000});
  if (!tokenRecord) {
    await recordPumpHeartbeat({ok: false, httpStatus: 401, durationMs: Date.now() - startedAt,
      message: "调度 Token 无效、已过期或已停用"});
    return NextResponse.json({error: "unauthorized"}, {status: 401});
  }

  try {
    const result = await runCheckQueuePump();
    await touchSchedulerToken(tokenRecord.id);
    await recordPumpHeartbeat({ok: true, httpStatus: 202, durationMs: Date.now() - startedAt,
      message: "skipped" in result && result.skipped ? `pump_busy: ${result.reason}` : null});
    return NextResponse.json(result, {status: 202});
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.error("[check-cx-pump] 执行一批队列任务失败", message);
    await recordPumpHeartbeat({ok: false, httpStatus: 503, durationMs: Date.now() - startedAt, message});
    return NextResponse.json({error: "检测任务未能完成，将由后续调度恢复"}, {status: 503});
  }
}
