import {NextResponse, type NextRequest} from "next/server";

import {requireAuth} from "../alerts/_auth";
import {createAdminClient} from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/admin/worker-triggers
 * 调度触发日志列表（分页）
 *
 * Query: status, trigger_type, worker_event, page(默认1), pageSize(默认50)
 */
export async function GET(request: NextRequest) {
  const err = await requireAuth();
  if (err) {
    return err;
  }

  const {searchParams} = request.nextUrl;
  const status = searchParams.get("status");
  const triggerType = searchParams.get("trigger_type");
  const workerEvent = searchParams.get("worker_event");
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? "50")), 500);
  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;

  let query = createAdminClient()
    .from("worker_trigger_logs")
    .select("*", {count: "exact"})
    .order("triggered_at", {ascending: false})
    .range(rangeFrom, rangeTo);

  if (status) query = query.eq("status", status);
  if (triggerType) query = query.eq("trigger_type", triggerType);
  if (workerEvent) query = query.eq("worker_event", workerEvent);

  const {data, error, count} = await query;
  if (error) {
    return NextResponse.json({error: error.message}, {status: 500});
  }

  return NextResponse.json({data: data ?? [], total: count ?? 0, page, pageSize});
}

export async function POST(request: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (action !== "repair" && action !== "abort") {
    return NextResponse.json({error: "无效操作"}, {status: 400});
  }
  const logId = body?.logId;
  if (action === "abort" && (typeof logId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(logId))) {
    return NextResponse.json({error: "中断操作必须提供有效日志 ID"}, {status: 400});
  }
  try {
    const {data, error} = await createAdminClient({requestTimeoutMs: 10_000})
      .rpc("manage_check_trigger", {p_log_id: action === "repair" ? null : logId});
    if (error) {
      console.error("[worker-triggers] 管理操作失败", {code: error.code});
      return NextResponse.json({error: "操作失败，请确认已执行日志修复迁移；若任务繁忙请稍后重试"}, {status: 503});
    }
    if (data?.error) return NextResponse.json({error: data.error}, {status: data.code === "not_found" ? 404 : 409});
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({error: "操作暂未完成，请刷新状态后重试"}, {status: 503});
  }
}
