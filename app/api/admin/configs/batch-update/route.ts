import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearPingCache } from "@/lib/core/global-state";
import { clearDashboardDataCache } from "@/lib/core/dashboard-data";
import { clearGroupDashboardCache } from "@/lib/core/group-data";
import { clearAvailabilityStatsCache } from "@/lib/database/availability";
import { normalizeTags } from "@/lib/utils/config-validation";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

type TagOp = { mode: "add" | "remove" | "set"; tags: string[] };

interface BatchUpdateBody {
  ids: string[];
  group_name?: string | null;
  enabled?: boolean;
  is_maintenance?: boolean;
  tags?: TagOp;
  force_update?: boolean;
}

/**
 * POST /api/admin/configs/batch-update
 * 统一批量更新入口：分组 / 启用 / 维护 / 标签（增/删/覆盖）。
 * 锁定配置默认跳过，force_update=true 时才纳入。
 */
export async function POST(request: NextRequest) {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as BatchUpdateBody;
  const { ids, group_name, enabled, is_maintenance, tags, force_update } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids 不能为空" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 读取目标配置的锁定状态与现有标签（标签增删需基于现值）
  const { data: rows, error: readErr } = await admin
    .from("check_configs")
    .select("id, locked, tags")
    .in("id", ids);
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const lockedIds = (rows ?? []).filter((r) => r.locked).map((r) => r.id);
  const targetIds = force_update ? ids : ids.filter((id) => !lockedIds.includes(id));

  if (targetIds.length === 0) {
    return NextResponse.json(
      { error: "所选配置均已锁定，需二次确认", locked: true, lockedIds },
      { status: 423 }
    );
  }

  // 标签增删需逐条计算，其余字段可统一 update
  if (tags) {
    const tagMap = new Map((rows ?? []).map((r) => [r.id, normalizeTags(r.tags)]));
    const opTags = normalizeTags(tags.tags);
    const removeSet = new Set(opTags);
    const results = await Promise.all(
      targetIds.map((id) => {
        const existing = tagMap.get(id) ?? [];
        let nextTags: string[];
        if (tags.mode === "set") nextTags = opTags;
        else if (tags.mode === "remove") nextTags = existing.filter((t) => !removeSet.has(t));
        else nextTags = [...new Set([...existing, ...opTags])];
        return admin.from("check_configs").update({ tags: nextTags, updated_at: new Date().toISOString() }).eq("id", id);
      })
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
  } else {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (group_name !== undefined) patch.group_name = group_name || null;
    if (typeof enabled === "boolean") patch.enabled = enabled;
    if (typeof is_maintenance === "boolean") patch.is_maintenance = is_maintenance;

    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
    }

    const { error } = await admin.from("check_configs").update(patch).in("id", targetIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  clearPingCache();
  clearDashboardDataCache();
  clearGroupDashboardCache();
  clearAvailabilityStatsCache();

  return NextResponse.json({ ok: true, count: targetIds.length, skippedLocked: lockedIds });
}
