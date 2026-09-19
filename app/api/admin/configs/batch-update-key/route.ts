import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearPingCache } from "@/lib/core/global-state";
import { clearConfigCache } from "@/lib/database/config-loader";

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
    const { ids, api_key } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0 || !api_key) {
      return NextResponse.json({ error: "缺少必填字段" }, { status: 400 });
    }

    const admin = createAdminClient();

    // 批量更新 API Key
    const { error } = await admin
      .from("check_configs")
      .update({ api_key })
      .in("id", ids);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 清理后端缓存
    clearPingCache();
    clearConfigCache();

    return NextResponse.json({ count: ids.length }, { status: 200 });
  } catch (error) {
    console.error("批量更新 Key 失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量更新失败" },
      { status: 500 }
    );
  }
}
