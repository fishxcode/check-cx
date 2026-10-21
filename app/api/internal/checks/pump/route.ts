import {NextResponse} from "next/server";

import {runCheckQueuePump} from "@/lib/core/check-queue-pump";
import {touchSchedulerToken, verifySchedulerToken} from "@/lib/database/scheduler-tokens";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 55;

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const tokenRecord = await verifySchedulerToken(token, {requestTimeoutMs: 5_000});
  if (!tokenRecord) return NextResponse.json({error: "unauthorized"}, {status: 401});

  try {
    const result = await runCheckQueuePump();
    await touchSchedulerToken(tokenRecord.id);
    return NextResponse.json(result, {status: 202});
  } catch (error) {
    console.error("[check-cx-pump] 执行一批队列任务失败", error instanceof Error ? error.message : "未知错误");
    return NextResponse.json({error: "检测任务未能完成，将由后续调度恢复"}, {status: 503});
  }
}
