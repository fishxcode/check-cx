import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearAllCaches } from "@/lib/core/cache-invalidation";
import { runChecksForConfigs } from "@/lib/core/config-check-execution";
import type { ProviderConfig, ProviderType } from "@/lib/types";

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
      stream_mode,
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
      stream_mode: stream_mode || null,
    }));

    const { data, error } = await admin
      .from("check_configs")
      .insert(configs)
      .select("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 全量失效前台缓存，并立即执行首检，让前台下一轮刷新就能看到新配置
    clearAllCaches();
    if (enabled !== false && !is_maintenance) {
      const firstCheckConfigs: ProviderConfig[] = configs.map((row, index) => ({
        id: data[index].id,
        name: row.name,
        type: type as ProviderType,
        model: row.model,
        endpoint,
        apiKey: api_key,
        is_maintenance,
        requestHeaders: row.request_header || null,
        metadata: row.metadata || null,
        groupName: row.group_name || null,
        streamMode: row.stream_mode || null,
      }));
      void runChecksForConfigs(firstCheckConfigs).catch(() => {});
    }

    return NextResponse.json({ count: data.length, ids: data.map((d) => d.id) }, { status: 201 });
  } catch (error) {
    console.error("批量创建配置失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量创建失败" },
      { status: 500 }
    );
  }
}
