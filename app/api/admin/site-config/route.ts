import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshSiteSettings } from "@/lib/core/site-settings";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

/**
 * 获取所有前台配置项
 */
export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("site_settings")
    .select("key,value,description,editable")
    .in("key", [
      "site.title",
      "site.description",
      "site.logo_url",
      "site.favicon_url",
      "site.github_url",
      "check_poll_interval_seconds",
    ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

/**
 * 更新前台配置项
 */
export async function PUT(request: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { key, value } = body;

  // value 允许为空字符串（如 github_url 置空代表不显示）
  if (!key || value === undefined || value === null) {
    return NextResponse.json({ error: "key 和 value 必填" }, { status: 400 });
  }

  // 仅允许编辑前台配置和系统配置
  const allowedKeys = [
    "site.title",
    "site.description",
    "site.logo_url",
    "site.favicon_url",
    "site.github_url",
    "check_poll_interval_seconds",
  ];
  if (!allowedKeys.includes(key)) {
    return NextResponse.json({ error: "不允许编辑此配置项" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("site_settings")
    .upsert({ key, value }, { onConflict: "key" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 更新后端缓存
  await refreshSiteSettings({ force: true });

  return NextResponse.json({ ok: true });
}
