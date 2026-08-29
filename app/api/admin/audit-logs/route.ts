import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

/**
 * GET /api/admin/audit-logs
 * 全局审计日志列表（分页）
 *
 * Query: config_id, action, actor_id, page(默认1), pageSize(默认50)
 */
export async function GET(request: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const configId = searchParams.get("config_id");
  const action = searchParams.get("action");
  const actorId = searchParams.get("actor_id");
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? "50")), 500);
  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;

  let query = createAdminClient()
    .from("config_audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (configId) query = query.eq("config_id", configId);
  if (action) query = query.eq("action", action);
  if (actorId) query = query.eq("actor_id", actorId);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
}
