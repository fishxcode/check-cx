import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearAllCaches } from "@/lib/core/cache-invalidation";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  return data.claims;
}

export async function POST(request: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { ids, endpoint } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0 || !endpoint) {
      return NextResponse.json({ error: "缺少必填字段" }, { status: 400 });
    }

    const admin = createAdminClient();

    // 批量更新端点
    const { error } = await admin
      .from("check_configs")
      .update({ endpoint })
      .in("id", ids);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 清理后端缓存
    clearAllCaches();

    return NextResponse.json({ count: ids.length }, { status: 200 });
  } catch (error) {
    console.error("批量更新端点失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量更新失败" },
      { status: 500 }
    );
  }
}
