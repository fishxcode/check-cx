import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearPingCache } from "@/lib/core/global-state";
import { clearDashboardDataCache } from "@/lib/core/dashboard-data";
import { clearGroupDashboardCache } from "@/lib/core/group-data";

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
    const {
      type,
      endpoint,
      api_key,
      models,
      group_name,
      request_header,
      metadata,
      enabled = true,
      is_maintenance = false,
    } = body;

    if (!type || !endpoint || !api_key || !models || !Array.isArray(models) || models.length === 0) {
      return NextResponse.json({ error: "缺少必填字段或模型列表为空" }, { status: 400 });
    }

    const admin = createAdminClient();

    // 批量插入配置
    const configs = models.map((model: string) => ({
      name: `${type.toUpperCase()} ${model}`,
      type,
      model,
      endpoint,
      api_key,
      enabled,
      is_maintenance,
      group_name: group_name || null,
      request_header: request_header || null,
      metadata: metadata || null,
    }));

    const { data, error } = await admin
      .from("check_configs")
      .insert(configs)
      .select("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 清理后端缓存
    clearPingCache();
    clearDashboardDataCache();
    clearGroupDashboardCache();

    return NextResponse.json({ count: data.length, ids: data.map((d) => d.id) }, { status: 201 });
  } catch (error) {
    console.error("批量创建配置失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量创建失败" },
      { status: 500 }
    );
  }
}
