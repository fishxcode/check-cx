import {NextResponse} from "next/server";

import {runCheckQueuePump} from "@/lib/core/check-queue-pump";
import {requireAuth} from "../../../alerts/_auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 管理员手动 kick 一次 pump。
 * 批量检测创建任务后由前端 fire-and-forget 调用，避免完全依赖 5 分钟心跳。
 */
export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const result = await runCheckQueuePump();
    return NextResponse.json(result, {status: 202});
  } catch (error) {
    console.error("[admin-pump] 触发检测失败", error instanceof Error ? error.message : "未知错误");
    return NextResponse.json({error: "推进检测队列失败"}, {status: 503});
  }
}
