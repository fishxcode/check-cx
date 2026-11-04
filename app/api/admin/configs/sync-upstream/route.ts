import {NextResponse} from "next/server";

import {createClient} from "@/lib/supabase/server";
import {previewUpstreamAdd, applyUpstreamAdd} from "@/lib/core/upstream-sync-add";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const auth = await createClient();
  const {data} = await auth.auth.getClaims();
  if (!data?.claims) return NextResponse.json({error: "未登录"}, {status: 401});

  let body: {ids?: unknown; action?: unknown};
  try { body = await request.json(); } catch { return NextResponse.json({error: "请求格式无效"}, {status: 400}); }
  const ids = body?.ids;
  const action = body?.action;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200
    || ids.some((id) => typeof id !== "string" || !UUID.test(id))
    || (action !== "preview" && action !== "apply")) {
    return NextResponse.json({error: "请选择 1 至 200 条有效配置，并指定 preview 或 apply"}, {status: 400});
  }

  try {
    if (action === "preview") {
      const diffs = await previewUpstreamAdd(ids as string[]);
      return NextResponse.json({diffs});
    }
    const result = await applyUpstreamAdd(ids as string[]);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[sync-upstream] 同步补齐上游新增失败", error instanceof Error ? error.message : "未知错误");
    return NextResponse.json({error: "同步暂不可用，请确认上游目录服务可访问"}, {status: 503});
  }
}
