import {NextResponse, type NextRequest} from "next/server";

import {runCheckQueuePump} from "@/lib/core/check-queue-pump";
import {touchSchedulerToken, verifySchedulerToken} from "@/lib/database/scheduler-tokens";
import {createAdminClient} from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 55;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] ?? "";
  const tokenRecord = await verifySchedulerToken(token, {requestTimeoutMs: 5_000});
  if (!tokenRecord) return NextResponse.json({error: "unauthorized"}, {status: 401});

  const body: unknown = await request.json().catch(() => ({}));
  const rawIds = body && typeof body === "object" && !Array.isArray(body)
    ? (body as {ids?: unknown}).ids : undefined;

  try {
    let ids: string[] | null = null;
    if (rawIds !== undefined && rawIds !== null) {
      if (!Array.isArray(rawIds) || rawIds.length === 0
        || rawIds.some((id) => typeof id !== "string" || !UUID.test(id))) {
        return NextResponse.json({error: "ids 必须是非空 UUID 数组"}, {status: 400});
      }
      ids = [...new Set((rawIds as string[]).map((id) => id.toLowerCase()))];
    }

    const {data, error} = await createAdminClient({requestTimeoutMs: 10_000})
      .rpc("dispatch_manual_check_queue", {p_ids: ids});
    if (error) {
      console.error("[checks-run] 创建手动轮次失败", {code: error.code});
      if (error.code === "55P03") {
        return NextResponse.json({error: "已有检测轮次正在运行，请稍后重试"}, {status: 409});
      }
      return NextResponse.json({error: "无法创建检测任务，请稍后重试"}, {status: 503});
    }

    const pump = await runCheckQueuePump();
    await touchSchedulerToken(tokenRecord.id).catch(() => {});
    return NextResponse.json({ok: true, ...data, pump, continuation: "next-cron-tick"}, {status: 202});
  } catch (error) {
    console.error("[checks-run] 创建持久检测任务失败", error instanceof Error ? error.message : "未知错误");
    return NextResponse.json({error: "检测队列暂不可用"}, {status: 503});
  }
}
