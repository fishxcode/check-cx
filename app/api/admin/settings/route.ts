import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

export async function GET() {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
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
