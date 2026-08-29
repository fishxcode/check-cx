import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearPingCache } from "@/lib/core/global-state";
import { clearDashboardDataCache } from "@/lib/core/dashboard-data";
import { clearGroupDashboardCache } from "@/lib/core/group-data";
import { clearAvailabilityStatsCache } from "@/lib/database/availability";
import { normalizeTags } from "@/lib/utils/config-validation";

type ImportMode = "create" | "update" | "upsert";

interface ImportConfig {
  name?: string;
  type?: string;
  model?: string;
  endpoint?: string;
  api_key?: string;
  enabled?: boolean;
  is_maintenance?: boolean;
  group_name?: string | null;
  request_header?: unknown;
  metadata?: unknown;
  stream_mode?: string | null;
  tags?: string[] | null;
}

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

export async function POST(request: NextRequest) {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const mode: ImportMode = body?.mode;
  const configs: ImportConfig[] = Array.isArray(body?.configs) ? body.configs : [];

  if (!["create", "update", "upsert"].includes(mode)) {
    return NextResponse.json({ error: "无效的导入模式" }, { status: 400 });
  }
  if (configs.length === 0) {
    return NextResponse.json({ error: "配置列表为空" }, { status: 400 });
  }

  const admin = createAdminClient();
  let imported = 0;
  let failed = 0;
  const errors: { index: number; name: string; error: string }[] = [];

  // 逐条处理，单条失败不影响其余
  for (let i = 0; i < configs.length; i++) {
    const c = configs[i];
    const name = c.name ?? "";
    try {
      // 必填校验
      if (!c.name || !c.type || !c.model || !c.endpoint) {
        throw new Error("缺少必填字段（name/type/model/endpoint）");
      }

      // 查询同名已存在配置
      const { data: existing } = await admin
        .from("check_configs")
        .select("id")
        .eq("name", c.name)
        .maybeSingle();

      // 组装写入字段
      const record: Record<string, unknown> = {
        name: c.name,
        type: c.type,
        model: c.model,
        endpoint: c.endpoint,
        enabled: c.enabled ?? true,
        is_maintenance: c.is_maintenance ?? false,
        group_name: c.group_name || null,
        request_header: c.request_header || null,
        metadata: c.metadata || null,
        stream_mode: c.stream_mode || null,
        tags: c.tags ? normalizeTags(c.tags) : null,
      };

      if (mode === "create") {
        if (existing) throw new Error("同名配置已存在，已跳过");
        if (!c.api_key) throw new Error("缺少必填字段（api_key）");
        record.api_key = c.api_key;
        const { error } = await admin.from("check_configs").insert(record);
        if (error) throw new Error(error.message);
      } else if (mode === "update") {
        if (!existing) throw new Error("同名配置不存在，已跳过");
        // api_key 为空时不覆盖原值
        if (c.api_key) record.api_key = c.api_key;
        record.updated_at = new Date().toISOString();
        const { error } = await admin.from("check_configs").update(record).eq("id", existing.id);
        if (error) throw new Error(error.message);
      } else {
        // upsert：存在则更新，不存在则插入
        if (existing) {
          if (c.api_key) record.api_key = c.api_key;
          record.updated_at = new Date().toISOString();
          const { error } = await admin.from("check_configs").update(record).eq("id", existing.id);
          if (error) throw new Error(error.message);
        } else {
          if (!c.api_key) throw new Error("缺少必填字段（api_key）");
          record.api_key = c.api_key;
          const { error } = await admin.from("check_configs").insert(record);
          if (error) throw new Error(error.message);
        }
      }

      imported++;
    } catch (e) {
      failed++;
      errors.push({ index: i, name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 有成功写入时清理后端缓存
  if (imported > 0) {
    clearPingCache();
    clearDashboardDataCache();
    clearGroupDashboardCache();
    clearAvailabilityStatsCache();
  }

  return NextResponse.json({ imported, failed, errors });
}
