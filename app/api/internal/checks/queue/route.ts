import {NextResponse} from "next/server";

import {dispatchCheckQueue, executeCheckQueueTask} from "@/lib/core/check-queue";
import {verifySchedulerToken} from "@/lib/database/scheduler-tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!await verifySchedulerToken(token, {requestTimeoutMs: 10_000})) return NextResponse.json({error: "unauthorized"}, {status: 401});
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({error: "无效请求"}, {status: 400});
  try {
    if (body.action === "dispatch" && ["scheduled", "fetch"].includes(body.event)) {
      return NextResponse.json(await dispatchCheckQueue(body.event));
    }
    if (body.action === "execute" && typeof body.taskId === "string" && UUID.test(body.taskId)) {
      const result = await executeCheckQueueTask(body.taskId);
      return NextResponse.json(result, {status: result.retry ? 202 : 200});
    }
    return NextResponse.json({error: "无效任务参数"}, {status: 400});
  } catch (error) {
    console.error("[check-cx-queue] 任务请求失败", error instanceof Error ? error.message : "未知错误");
    return NextResponse.json({error: "任务暂未完成，请重试"}, {status: 503});
  }
}
