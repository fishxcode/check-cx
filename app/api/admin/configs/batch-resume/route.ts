import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearAllCaches } from "@/lib/core/cache-invalidation";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

export async function POST(request: NextRequest) {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { ids } = body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids is required and must be a non-empty array" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error, count } = await admin.from("check_configs").update({ paused_until: null, pause_reason: null }).in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  clearAllCaches();

  return NextResponse.json({ ok: true, count });
}
