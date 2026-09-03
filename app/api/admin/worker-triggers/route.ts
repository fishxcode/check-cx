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
