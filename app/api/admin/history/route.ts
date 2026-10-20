import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearAllCaches } from "@/lib/core/cache-invalidation";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

export async function GET(request: NextRequest) {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const page     = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get("pageSize") ?? "50", 10)));
  const configId = searchParams.get("config_id") ?? "";
  const status   = searchParams.get("status") ?? "";

  const admin = createAdminClient();
  const from = (page - 1) * pageSize;
  const to   = from + pageSize - 1;

  let query = admin
    .from("check_history")
    .select(
      "id, config_id, status, latency_ms, ping_latency_ms, checked_at, message, check_configs(name, type)",
      { count: "exact" }
    )
    .order("checked_at", { ascending: false })
    .range(from, to);

  if (configId) query = query.eq("config_id", configId);
  if (status)   query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
}

export async function DELETE(request: NextRequest) {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "请求参数格式错误" }, { status: 400 });
  }

  const { all, ids } = body as { all?: unknown; ids?: unknown };
  if (all !== undefined && (all !== true || ids !== undefined)) {
    return NextResponse.json({ error: "清空历史请仅指定 all: true" }, { status: 400 });
  }
  if (all !== true && (
    !Array.isArray(ids) || ids.length === 0 ||
    ids.some((id: unknown) => typeof id !== "string" || !id.trim())
  )) {
    return NextResponse.json({ error: "请选择有效的检测记录" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    if (all === true) {
      // 固定本次清理边界，后续定时检测继续正常写入。
      const cutoff = new Date().toISOString();
      const { error, count } = await admin
        .from("check_history")
        .delete({ count: "exact" })
        .lte("checked_at", cutoff);
      if (error) {
        return NextResponse.json({ error: "清空检测历史失败，请稍后重试" }, { status: 500 });
      }
      clearAllCaches();
      return NextResponse.json({ ok: true, deletedCount: count ?? 0, cutoff });
    }

    const { error } = await admin.from("check_history").delete().in("id", ids as string[]);
    if (error) {
      return NextResponse.json({ error: "删除检测记录失败，请稍后重试" }, { status: 500 });
    }
    clearAllCaches();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "删除检测记录失败，请稍后重试" }, { status: 500 });
  }
}
