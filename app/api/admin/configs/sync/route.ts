import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {runUpstreamSync} from "@/lib/core/upstream-sync";
import {clearAllCaches} from "@/lib/core/cache-invalidation";

export async function POST(request: Request) {
  const auth = await createClient();
  const {data} = await auth.auth.getClaims();
  if (!data?.claims) return NextResponse.json({error: "未登录"}, {status: 401});
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({error: "请求格式无效"}, {status: 400}); }
  const {action, ids} = body ?? {};
  if (!["enable", "disable", "preview", "sync"].includes(action) || !Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) return NextResponse.json({error: "请选择 1 至 200 条有效配置"}, {status: 400});
  try {
    if (action === "enable" || action === "disable") {
      const {data: changed, error} = await createAdminClient().from("check_configs").update({sync_enabled: action === "enable", updated_at: new Date().toISOString()}).in("id", ids).eq("locked", false).select("id");
      if (error) throw new Error("同步配置写入失败");
      clearAllCaches();
      return NextResponse.json({updated: changed?.length ?? 0});
    }
    const results = await runUpstreamSync({ids, preview: action === "preview"});
    return NextResponse.json({results, preview: action === "preview"});
  } catch {
    return NextResponse.json({error: "同步暂不可用，请确认数据库迁移及上游目录服务"}, {status: 503});
  }
}
