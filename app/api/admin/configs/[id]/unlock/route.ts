import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearPingCache } from "@/lib/core/global-state";
import { writeAuditLog } from "@/lib/database/audit-log";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

/**
 * POST /api/admin/configs/[id]/unlock
 * 解锁配置。body: { reason?: string }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requireAuth();
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reason: string | null = body?.reason || null;

  const admin = createAdminClient();
  const { error } = await admin
    .from("check_configs")
    .update({
      locked: false,
      locked_at: null,
      locked_by: null,
      lock_reason: null,
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  clearPingCache();

  await writeAuditLog({
    configId: id,
    action: "unlock",
    actorId: String(claims.sub ?? ""),
    actorEmail: String(claims.email ?? ""),
    reason,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}
