import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshSiteSettings } from "@/lib/core/site-settings";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { key } = await params;
  const body = await request.json();
  const { value } = body;

  const admin = createAdminClient();

  // 确认该 key 存在且 editable=true
  const { data: setting, error: fetchErr } = await admin
    .from("site_settings")
    .select("editable")
    .eq("key", key)
    .single();

  if (fetchErr || !setting) return NextResponse.json({ error: "设置项不存在" }, { status: 404 });
  if (!setting.editable) return NextResponse.json({ error: "该设置项不可编辑" }, { status: 403 });

  const { error } = await admin.from("site_settings").update({ value: String(value) }).eq("key", key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 更新后端缓存
  await refreshSiteSettings();

  return NextResponse.json({ ok: true });
}
