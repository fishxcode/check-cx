import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

/**
 * GET /api/admin/tags
 * 返回所有标签及使用次数 [{ tag, count }]。
 * 优先 RPC get_all_tags，出错则降级为 JS 聚合。
 */
export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data, error } = await admin.rpc("get_all_tags");
  if (!error) return NextResponse.json(data ?? []);

  // 降级：读取所有 tags 后在 JS 侧聚合
  const fallback = await admin.from("check_configs").select("tags");
  if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });

  const counts = new Map<string, number>();
  for (const row of fallback.data ?? []) {
    const tags = (row as { tags: string[] | null }).tags ?? [];
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const result = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  return NextResponse.json(result);
}
