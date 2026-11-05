import {NextResponse} from "next/server";

import {createAdminClient} from "@/lib/supabase/admin";
import {abortStaleCheckRun} from "@/lib/database/check-queue-pump";
import {requireAuth} from "../alerts/_auth";

export const dynamic = "force-dynamic";

/** 返回最近一次调度心跳，用于在管理后台区分 Token 失效与触发器停摆。 */
export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  // 即使外部心跳停摆，管理员打开后台也能触发一次停滞轮次清理，避免永久「执行中」。
  void abortStaleCheckRun().catch(() => {});

  const {data, error} = await createAdminClient({requestTimeoutMs: 10_000})
    .from("pump_heartbeats")
    .select("created_at,ok,http_status,duration_ms,message")
    .order("created_at", {ascending: false})
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({error: "读取调度心跳失败"}, {status: 503});
  return NextResponse.json(data ?? null, {headers: {"Cache-Control": "no-store"}});
}
