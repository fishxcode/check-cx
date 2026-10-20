import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "../../alerts/_auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProviderConfig, ProviderType } from "@/lib/types";
import { runChecksForConfigs } from "@/lib/core/config-check-execution";
import { touchSchedulerToken, verifySchedulerToken } from "@/lib/database/scheduler-tokens";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  let schedulerTokenId: string | null = null;
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization);
    const token = match?.[1] ?? "";
    const tokenRecord = await verifySchedulerToken(token, {requestTimeoutMs: 10_000});
    if (!tokenRecord) return NextResponse.json({error: "调度 Token 无效、已过期或已停用"}, {status: 401});
    schedulerTokenId = tokenRecord.id;
  } else {
    const sessionError = await requireAuth();
    if (sessionError) return sessionError;
  }

  const body = await request.json().catch(() => null);
  const rawIds: unknown = body && typeof body === "object" && !Array.isArray(body)
    ? (body as {ids?: unknown}).ids : null;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json({error: "ids 不能为空，且必须是 UUID 数组"}, {status: 400});
  }
  if (rawIds.length > 300 || !rawIds.every((id): id is string => typeof id === "string" && UUID.test(id))) {
    return NextResponse.json({error: "ids 必须是有效 UUID，最多支持 300 个"}, {status: 400});
  }
  const ids = [...new Set(rawIds.map((id) => id.toLowerCase()))];

  const admin = createAdminClient({requestTimeoutMs: 10_000});
  const {data, error} = await admin
    .from("check_configs")
    .select("id,name,type,model,endpoint,api_key,is_maintenance,request_header,metadata,group_name,stream_mode")
    .in("id", ids);

  if (error) return NextResponse.json({error: "读取检测配置失败"}, {status: 503});
  const foundIds = new Set((data ?? []).map((row) => String(row.id).toLowerCase()));
  const missingIds = ids.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    return NextResponse.json({error: "部分配置不存在，本次未执行检测", missingIds}, {status: 404});
  }

  const configs: ProviderConfig[] = (data ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type as ProviderType,
    endpoint: d.endpoint,
    model: d.model,
    apiKey: d.api_key,
    is_maintenance: d.is_maintenance,
    requestHeaders: (d.request_header as Record<string, string>) || null,
    metadata: (d.metadata as Record<string, unknown>) || null,
    groupName: d.group_name || null,
    streamMode: d.stream_mode || null,
  }));

  if (schedulerTokenId) {
    try {
      await touchSchedulerToken(schedulerTokenId, {requestTimeoutMs: 2_000});
    } catch {
      console.error("[batch-test] 更新调度 Token 使用时间失败");
    }
  }

  let results;
  try {
    results = await runChecksForConfigs(configs, {strictPersistence: true});
  } catch (error) {
    console.error("[batch-test] 批量检测失败", error instanceof Error ? error.message : "未知错误");
    return NextResponse.json({error: "批量检测暂未完成，请稍后重试"}, {status: 503});
  }

  const resultMap = Object.fromEntries(
    results.map((r) => [r.id, { status: r.status, latencyMs: r.latencyMs, message: r.message ?? null }])
  );
  return NextResponse.json(resultMap, {headers: {
    "Cache-Control": "no-store",
    "X-Check-Execution-Mode": "sync",
    "X-Check-Requested-Count": String(ids.length),
    "X-Check-Result-Count": String(results.length),
  }});
}
