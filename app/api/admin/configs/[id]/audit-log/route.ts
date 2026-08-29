import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

/**
 * GET /api/admin/configs/[id]/audit-log
 * 获取指定配置的审计日志历史
 *
 * Query 参数:
 * - limit: 返回记录数（默认 50，最大 200）
 * - offset: 偏移量（用于分页）
 * - action: 筛选操作类型（create/update/delete/enable/disable/lock/unlock）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);

  const limit = Math.min(
    parseInt(searchParams.get("limit") || "50", 10),
    200
  );
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const actionFilter = searchParams.get("action");

  try {
    const admin = createAdminClient();

    // 构建查询
    let query = admin
      .from("config_audit_log")
      .select("*", { count: "exact" })
      .eq("config_id", id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // 如果指定了 action 筛选
    if (actionFilter) {
      query = query.eq("action", actionFilter);
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data || [],
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit,
      },
    });
  } catch (err) {
    console.error("Failed to fetch audit log:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
