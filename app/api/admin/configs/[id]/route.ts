import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearPingCache } from "@/lib/core/global-state";
import { clearDashboardDataCache } from "@/lib/core/dashboard-data";
import { clearGroupDashboardCache } from "@/lib/core/group-data";
import { clearAvailabilityStatsCache } from "@/lib/database/availability";
import { writeAuditLog, diffFields } from "@/lib/database/audit-log";
import { normalizeTags, validateOptionalInt, CHECK_INTERVAL_RANGE, LATENCY_THRESHOLD_RANGE } from "@/lib/utils/config-validation";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

/** 从 claims 提取操作者信息 */
function getActor(claims: Record<string, unknown>) {
  return {
    actorId: String(claims.sub ?? ""),
    actorEmail: String(claims.email ?? "unknown"),
  };
}

/** 剔除敏感字段后的配置快照，用于审计 */
function snapshot(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  const { api_key: _omit, ...rest } = row;
  void _omit;
  return rest;
}

function clearCaches() {
  clearPingCache();
  clearDashboardDataCache();
  clearGroupDashboardCache();
  clearAvailabilityStatsCache();
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requireAuth();
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const { name, type, model, endpoint, api_key, enabled, is_maintenance, group_name, request_header, metadata, stream_mode, tags, check_interval_override, latency_threshold_ms, reason } = body;

  const admin = createAdminClient();

  // 读取变更前快照（用于审计 + 锁定校验）
  const { data: before } = await admin.from("check_configs").select("*").eq("id", id).single();
  if (before?.locked && !body.force_update) {
    return NextResponse.json({ error: "配置已锁定，需二次确认", locked: true }, { status: 423 });
  }

  // 服务端范围校验：与前端输入控件一致，防止绕过前端写入非法值
  const intervalCheck = validateOptionalInt(check_interval_override, CHECK_INTERVAL_RANGE.min, CHECK_INTERVAL_RANGE.max);
  if ("error" in intervalCheck) return NextResponse.json({ error: `检查间隔${intervalCheck.error}` }, { status: 400 });
  const thresholdCheck = validateOptionalInt(latency_threshold_ms, LATENCY_THRESHOLD_RANGE.min, LATENCY_THRESHOLD_RANGE.max);
  if ("error" in thresholdCheck) return NextResponse.json({ error: `延迟阈值${thresholdCheck.error}` }, { status: 400 });

  const update: Record<string, unknown> = {
    name, type, model, endpoint, enabled, is_maintenance,
    group_name: group_name || null,
    request_header: request_header || null,
    metadata: metadata || null,
    stream_mode: stream_mode || null,
    tags: normalizeTags(tags),
    check_interval_override: intervalCheck.value,
    latency_threshold_ms: thresholdCheck.value,
    updated_at: new Date().toISOString(),
  };
  if (api_key) update.api_key = api_key;

  const { error } = await admin.from("check_configs").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: after } = await admin.from("check_configs").select("*").eq("id", id).single();
  clearCaches();

  const beforeSnap = snapshot(before);
  const afterSnap = snapshot(after);
  await writeAuditLog({
    configId: id,
    action: "update",
    ...getActor(claims),
    beforeData: beforeSnap,
    afterData: afterSnap,
    changedFields: beforeSnap && afterSnap ? diffFields(beforeSnap, afterSnap) : null,
    reason: reason || null,
  });

  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requireAuth();
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const { reason: _reason, force_update, ...rest } = body;
  void _reason;

  // 白名单：仅允许通过 PATCH 切换的字段，杜绝客户端直接篡改锁定/审计等受控字段
  const ALLOWED_PATCH_FIELDS = ["enabled", "is_maintenance"] as const;
  const patch: Record<string, unknown> = {};
  for (const key of ALLOWED_PATCH_FIELDS) {
    if (key in rest) patch[key] = rest[key];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: before } = await admin.from("check_configs").select("*").eq("id", id).single();

  // 锁定保护：锁定配置需 force_update 二次确认
  if (before?.locked && !force_update) {
    return NextResponse.json({ error: "配置已锁定，需二次确认", locked: true }, { status: 423 });
  }

  const { error } = await admin.from("check_configs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: after } = await admin.from("check_configs").select("*").eq("id", id).single();
  clearCaches();

  // 判定动作类型：启用/禁用切换单独标注
  let action = "update";
  if ("enabled" in patch && Object.keys(patch).length === 1) {
    action = patch.enabled ? "enable" : "disable";
  }
  const beforeSnap = snapshot(before);
  const afterSnap = snapshot(after);
  await writeAuditLog({
    configId: id,
    action,
    ...getActor(claims),
    beforeData: beforeSnap,
    afterData: afterSnap,
    changedFields: beforeSnap && afterSnap ? diffFields(beforeSnap, afterSnap) : null,
    reason: null,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requireAuth();
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const forceDelete = searchParams.get("force") === "true";

  const admin = createAdminClient();
  const { data: before } = await admin.from("check_configs").select("*").eq("id", id).single();
  if (before?.locked && !forceDelete) {
    return NextResponse.json({ error: "配置已锁定，需二次确认", locked: true }, { status: 423 });
  }

  // FK 已改为 ON DELETE SET NULL，删除前写入审计，记录保留（config_id 置空）
  const beforeSnap = snapshot(before);
  await writeAuditLog({
    configId: id,
    action: "delete",
    ...getActor(claims),
    beforeData: beforeSnap,
    afterData: null,
    changedFields: null,
    reason: null,
  });

  const { error } = await admin.from("check_configs").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  clearCaches();
  return NextResponse.json({ ok: true });
}
