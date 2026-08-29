import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearPingCache } from "@/lib/core/global-state";
import { normalizeTags } from "@/lib/utils/config-validation";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

/**
 * PATCH /api/admin/configs/[id]/tags
 * 全量覆盖: { tags: string[] }
 * 增量修改: { add?: string[], remove?: string[] }
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const admin = createAdminClient();

  // 锁定保护：锁定配置需 force_update 二次确认
  const { data: lockRow } = await admin.from("check_configs").select("locked").eq("id", id).single();
  if (lockRow?.locked && !body?.force_update) {
    return NextResponse.json({ error: "配置已锁定，需二次确认", locked: true }, { status: 423 });
  }

  let tags: string[];

  if (Array.isArray(body?.tags)) {
    // 全量覆盖
    tags = normalizeTags(body.tags);
  } else {
    // 增量：先读现有标签再合并
    const current = await admin.from("check_configs").select("tags").eq("id", id).single();
    if (current.error) return NextResponse.json({ error: current.error.message }, { status: 500 });

    const existing = normalizeTags((current.data as { tags: string[] | null })?.tags ?? []);
    const add = normalizeTags(body?.add);
    const remove = new Set(normalizeTags(body?.remove));

    tags = [...new Set([...existing, ...add])].filter((t) => !remove.has(t));
  }

  const { error } = await admin.from("check_configs").update({ tags }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  clearPingCache();

  return NextResponse.json({ ok: true, tags });
}
