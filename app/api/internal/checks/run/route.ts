import {NextResponse, type NextRequest} from "next/server";

import {createAdminClient} from "@/lib/supabase/admin";
import {runChecksForConfigs} from "@/lib/core/config-check-execution";
import {loadProviderConfigsFromDB} from "@/lib/database/config-loader";
import {
  touchSchedulerToken,
  verifySchedulerToken,
} from "@/lib/database/scheduler-tokens";
import {
  createTriggerLog,
  finishTriggerLog,
} from "@/lib/database/worker-trigger-logs";
import type {ProviderConfig, ProviderType} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

interface RunChecksRequestBody {
  ids?: string[];
  failOnIssues?: boolean;
}

function getBearerToken(request: NextRequest): string {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return "";
  }
  return authorization.slice("Bearer ".length).trim();
}

function mapConfig(row: Record<string, unknown>): ProviderConfig {
  return {
    id: String(row.id),
    name: String(row.name),
    type: row.type as ProviderType,
    endpoint: String(row.endpoint),
    model: String(row.model),
    apiKey: String(row.api_key),
    is_maintenance: Boolean(row.is_maintenance),
    requestHeaders: (row.request_header as Record<string, string>) || null,
    metadata: (row.metadata as Record<string, unknown>) || null,
    groupName: (row.group_name as string | null) || null,
    streamMode: (row.stream_mode as ProviderConfig["streamMode"]) || null,
  };
}

async function loadConfigsByIds(ids: string[]): Promise<ProviderConfig[]> {
  const admin = createAdminClient();
  const {data, error} = await admin
    .from("check_configs")
    .select("id,name,type,model,endpoint,api_key,is_maintenance,request_header,metadata,group_name,stream_mode")
    .in("id", ids)
    .order("name");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapConfig(row as Record<string, unknown>));
}

export async function POST(request: NextRequest) {
  const token = getBearerToken(request);
  const tokenRecord = await verifySchedulerToken(token);
  if (!tokenRecord) {
    return NextResponse.json({error: "unauthorized"}, {status: 401});
  }

  // ---------- 触发日志 ----------
  // 检测开始前先落一条记录，保证"触达过服务端"这一事实不因执行中断丢失。
  // x-cx-trigger: scheduled = CF Worker Cron 定时触发；fetch = CF Worker 手动触发。
  // 未带该头的调用（如 Uptime Kuma 等第三方）记录为 token 类型。
  const triggerHeader = request.headers.get("x-cx-trigger") ?? "";
  const workerEvent =
    triggerHeader === "scheduled" || triggerHeader === "fetch"
      ? triggerHeader
      : null;
  const attemptId =
    request.headers.get("x-cx-attempt-id") ??
    request.nextUrl.searchParams.get("attempt_id") ??
    `token-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const logId = await createTriggerLog({
    attemptId,
    triggerType: workerEvent ? "worker" : "token",
    workerEvent,
    tokenName: workerEvent ? null : tokenRecord.name,
  });

  const startedAtMs = Date.now();
  try {
    const body = await request.json().catch(() => ({} as RunChecksRequestBody));
    const rawIds: unknown[] = Array.isArray(body.ids) ? body.ids : [];
    const ids = rawIds.length > 0
      ? rawIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const failOnIssues = body.failOnIssues !== false;

    const configs = ids.length > 0
      ? await loadConfigsByIds(ids)
      : await loadProviderConfigsFromDB({forceRefresh: true});

    if (ids.length > 0 && configs.length === 0) {
      await finishTriggerLog(logId, {
        status: "failed",
        durationMs: Date.now() - startedAtMs,
        configCount: 0,
        issueCount: 0,
        message: "未找到指定配置",
      });
      return NextResponse.json({error: "未找到指定配置"}, {status: 404});
    }

    const results = await runChecksForConfigs(configs);

    const issueResults = results.filter((result) =>
      ["failed", "validation_failed", "error"].includes(result.status)
    );
    const degradedResults = results.filter((result) => result.status === "degraded");

    const payload = {
      ok: issueResults.length === 0,
      source: "scheduler-token",
      tokenName: tokenRecord.name,
      total: results.length,
      issueCount: issueResults.length,
      degradedCount: degradedResults.length,
      results: results.map((result) => ({
        id: result.id,
        name: result.name,
        status: result.status,
        latencyMs: result.latencyMs,
        pingLatencyMs: result.pingLatencyMs,
        checkedAt: result.checkedAt,
        message: result.message ?? null,
      })),
    };

    await finishTriggerLog(logId, {
      status: issueResults.length > 0 ? "failed" : "success",
      durationMs: Date.now() - startedAtMs,
      configCount: results.length,
      issueCount: issueResults.length,
      message: issueResults.length > 0
        ? `${issueResults.length} 个配置异常`
        : `检测完成，${results.length} 个配置正常`,
    });
    await touchSchedulerToken(tokenRecord.id);

    if (failOnIssues && issueResults.length > 0) {
      return NextResponse.json(payload, {status: 503});
    }

    return NextResponse.json(payload);
  } catch (error) {
    await finishTriggerLog(logId, {
      status: "failed",
      durationMs: Date.now() - startedAtMs,
      configCount: null,
      issueCount: null,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
