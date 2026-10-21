import {NextResponse, type NextRequest} from "next/server";

import {requireAuth} from "../../alerts/_auth";
import {createAdminClient} from "@/lib/supabase/admin";
import {touchSchedulerToken, verifySchedulerToken} from "@/lib/database/scheduler-tokens";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorize(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization);
    const tokenRecord = await verifySchedulerToken(match?.[1] ?? "", {requestTimeoutMs: 5_000});
    return tokenRecord
      ? {tokenRecord, error: null}
      : {tokenRecord: null, error: NextResponse.json({error: "调度 Token 无效、已过期或已停用"}, {status: 401})};
  }
  const error = await requireAuth();
  return {tokenRecord: null, error};
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  const rawIds: unknown = body && typeof body === "object" && !Array.isArray(body)
    ? (body as {ids?: unknown}).ids : null;
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 300
    || rawIds.some((id) => typeof id !== "string" || !UUID.test(id))) {
    return NextResponse.json({error: "ids 必须是 1–300 个 UUID"}, {status: 400});
  }

  try {
    const ids = [...new Set((rawIds as string[]).map((id) => id.toLowerCase()))];
    const {data, error} = await createAdminClient({requestTimeoutMs: 10_000})
      .rpc("dispatch_manual_check_queue", {p_ids: ids});
    if (error) {
      console.error("[batch-test] 创建检测轮次失败", {code: error.code});
      if (error.code === "55P03") {
        return NextResponse.json({error: "已有检测轮次正在运行，请稍后重试"}, {status: 409});
      }
      return NextResponse.json({error: "无法创建检测任务，请稍后重试"}, {status: 503});
    }
    if (auth.tokenRecord) await touchSchedulerToken(auth.tokenRecord.id).catch(() => {});
    return NextResponse.json({ok: true, ...data}, {status: 202});
  } catch (error) {
    console.error("[batch-test] 创建检测轮次失败", error instanceof Error ? error.message : "未知错误");
    return NextResponse.json({error: "无法创建检测任务，请稍后重试"}, {status: 503});
  }
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;

  const attemptId = request.nextUrl.searchParams.get("attemptId") ?? "";
  if (!attemptId || attemptId.length > 200) {
    return NextResponse.json({error: "必须提供有效的 attemptId"}, {status: 400});
  }

  const admin = createAdminClient({requestTimeoutMs: 10_000});
  const {data: run, error: runError} = await admin.from("check_queue_runs")
    .select("id,attempt_id,status,config_count,completed_count,checked_count,issue_count,error_count,created_at,finished_at")
    .eq("attempt_id", attemptId).maybeSingle();
  if (runError) return NextResponse.json({error: "读取任务状态失败"}, {status: 503});
  if (!run) return NextResponse.json({error: "检测任务不存在"}, {status: 404});

  const {data: tasks, error: taskError} = await admin.from("check_queue_tasks")
    .select("config_id,kind,status,result")
    .eq("run_id", run.id)
    .eq("kind", "check")
    .eq("status", "completed");
  if (taskError) return NextResponse.json({error: "读取检测结果失败"}, {status: 503});

  const results = Object.fromEntries((tasks ?? []).flatMap((task) => {
    const result = task.result as {status?: string; latencyMs?: number | null; message?: string | null} | null;
    return task.config_id && result?.status
      ? [[task.config_id, {status: result.status, latencyMs: result.latencyMs ?? null, message: result.message ?? null}]]
      : [];
  }));

  return NextResponse.json({run, results}, {headers: {"Cache-Control": "no-store"}});
}
