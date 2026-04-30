import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const REQUIRED_SITE_SETTINGS = [
  {
    key: "global_group_health.enabled",
    value: "true",
    description: "是否在前台展示 New API 全局分组监控",
    editable: true,
    value_type: "boolean",
  },
  {
    key: "global_group_health.newapi_base_url",
    value: "",
    description: "New API 服务地址，例如 https://api.example.com",
    editable: true,
    value_type: "string",
  },
  {
    key: "global_group_health.newapi_access_token",
    value: "",
    description: "New API 系统访问令牌（私密密钥，留空则不修改）",
    editable: true,
    value_type: "secret",
  },
  {
    key: "global_group_health.newapi_user_id",
    value: "",
    description: "New API 用户 ID；留空表示全局统计，不按用户过滤",
    editable: true,
    value_type: "number",
  },
  {
    key: "global_group_health.show_error_reasons",
    value: "false",
    description: "是否展示全局分组监控的主要错误详情和复制按钮",
    editable: true,
    value_type: "boolean",
  },
];

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

export async function GET() {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  await admin.from("site_settings").upsert(REQUIRED_SITE_SETTINGS, {
    onConflict: "key",
    ignoreDuplicates: true,
  });
  const { data, error } = await admin.from("site_settings").select("*").order("key");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 脱敏：secret 类型返回 ••••+末4位，避免明文暴露
  const masked = (data ?? []).map((row) => {
    if (row.value_type === "secret" && row.value) {
      const v = row.value as string;
      return { ...row, value: "••••" + v.slice(-4) };
    }
    return row;
  });

  return NextResponse.json(masked);
}
