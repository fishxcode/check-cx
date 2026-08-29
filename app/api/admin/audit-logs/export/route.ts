import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ConfigAuditLogRow } from "@/lib/types/database";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

/** CSV 字段转义：含逗号、引号、换行时用双引号包裹，内部引号翻倍 */
function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const MAX_EXPORT = 5000;

/**
 * GET /api/admin/audit-logs/export
 * 导出审计日志为 CSV（无分页，最多 5000 条）
 *
 * Query: config_id, action, actor_id
 */
export async function GET(request: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const configId = searchParams.get("config_id");
  const action = searchParams.get("action");
  const actorId = searchParams.get("actor_id");

  let query = createAdminClient()
    .from("config_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(MAX_EXPORT);

  if (configId) query = query.eq("config_id", configId);
  if (action) query = query.eq("action", action);
  if (actorId) query = query.eq("actor_id", actorId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as ConfigAuditLogRow[];
  const header = ["时间", "操作", "操作人", "配置ID", "变更字段", "原因"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      csvCell(r.created_at),
      csvCell(r.action),
      csvCell(r.actor_email),
      csvCell(r.config_id),
      csvCell((r.changed_fields ?? []).join("; ")),
      csvCell(r.reason ?? ""),
    ].join(","));
  }
  // BOM 前缀，保证 Excel 正确识别 UTF-8
  const csvText = "﻿" + lines.join("\r\n");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return new Response(csvText, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-logs-${timestamp}.csv"`,
    },
  });
}
