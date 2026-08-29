import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

const LIMIT = 50;

/**
 * GET /api/admin/configs/[id]/audit-history
 * 通过 RPC 获取指定配置的审计历史；RPC 出错则降级为直接 select。
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("get_config_audit_history", {
    target_config_id: id,
    limit_count: LIMIT,
  });

  if (!error) return NextResponse.json(data ?? []);

  // 降级：直接查表
  const fallback = await admin
    .from("config_audit_log")
    .select("*")
    .eq("config_id", id)
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });
  return NextResponse.json(fallback.data ?? []);
}
