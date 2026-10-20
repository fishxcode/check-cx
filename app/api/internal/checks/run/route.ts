import {NextResponse, type NextRequest} from "next/server";

import {createAdminClient} from "@/lib/supabase/admin";
import {runChecksForConfigs} from "@/lib/core/config-check-execution";
import {dispatchCheckQueue} from "@/lib/core/check-queue";
import {runOfficialStatusCheckOnce} from "@/lib/core/official-status-poller";
import {ensurePollerLeadership, isPollerLeader, releasePollerLeadership} from "@/lib/core/poller-leadership";
import {setLastPingStartedAt, setPollerRunning} from "@/lib/core/global-state";
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
  mode?: "queue" | "sync";
  event?: "scheduled" | "fetch";
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
  const tokenRecord = await verifySchedulerToken(token, {requestTimeoutMs: 10_000});
  if (!tokenRecord) {
    return NextResponse.json({error: "unauthorized"}, {status: 401});
  }

  let body: RunChecksRequestBody;
  try {
    const text = await request.text();
    const value: unknown = text.trim() ? JSON.parse(text) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("请求体必须是 JSON 对象");
    }
    const input = value as Record<string, unknown>;
    if (input.mode !== undefined && input.mode !== "queue" && input.mode !== "sync") {
      throw new Error("mode 仅支持 queue 或 sync");
    }
    if (input.event !== undefined && input.event !== "scheduled" && input.event !== "fetch") {
      throw new Error("event 仅支持 scheduled 或 fetch");
    }
    if (input.failOnIssues !== undefined && typeof input.failOnIssues !== "boolean") {
      throw new Error("failOnIssues 必须是布尔值");
    }
    if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.length === 0 ||
      !input.ids.every((id) => typeof id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))) {
      throw new Error("ids 必须是非空的配置 UUID 数组");
    }
    body = input as RunChecksRequestBody;
  } catch (error) {
    return NextResponse.json({error: error instanceof SyntaxError
      ? "请求体不是有效 JSON"
      : error instanceof Error ? error.message : "无效请求"}, {status: 400});
  }
  const ids = [...new Set(body.ids ?? [])];
  const mode = body.mode ?? (ids.length === 0 ? "queue" : "sync");
  if (mode === "queue" && ids.length > 0) {
    return NextResponse.json({error: "队列模式不支持 ids；指定配置请使用 sync 模式"}, {status: 400});
  }
  if (mode === "sync" && ids.length === 0) {
    return NextResponse.json({error: "同步检测必须指定 ids"}, {status: 400});
  }
  if (mode === "sync" && ids.length > 300) {
    return NextResponse.json({error: "同步检测最多 300 个配置，请使用队列调度"}, {status: 422});
  }

  if (mode === "queue") {
    try {
      const event = body.event ?? (request.headers.get("x-cx-trigger") === "scheduled" ? "scheduled" : "fetch");
      // 先确认生产者绑定可用，避免数据库已建轮次但当前请求无法投递消息。
      const {env} = await import("cloudflare:workers");
      const queue = env.CHECK_QUEUE;
      if (!queue || typeof queue.sendBatch !== "function") {
        return NextResponse.json({error: "主站未绑定 CHECK_QUEUE"}, {status: 503});
      }
      const plan = await dispatchCheckQueue(event);
      // 投递成功后才响应；中途失败由持久化任务和下一次调度补偿。
      for (let offset = 0; offset < plan.tasks.length; offset += 100) {
        await queue.sendBatch(plan.tasks.slice(offset, offset + 100).map((taskId) => ({
          body: {taskId}, contentType: "json" as const,
        })));
      }
      try {
        await touchSchedulerToken(tokenRecord.id, {requestTimeoutMs: 2_000});
      } catch {
        console.error("[check-cx-run] 更新 Token 使用时间失败");
      }
      return NextResponse.json({
        ok: true,
        mode: "queue",
        attemptId: plan.attemptId,
        intervalSeconds: plan.intervalSeconds,
        queuedCount: plan.tasks.length,
      }, {status: 202});
    } catch (error) {
      console.error("[check-cx-run] 队列调度失败", error instanceof Error ? error.message : "未知错误");
      return NextResponse.json({error: "队列调度暂未完成，请稍后重试"}, {status: 503});
    }
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
  let ownsRunLock = false;
  try {
    await ensurePollerLeadership();
    if (!isPollerLeader()) {
      await finishTriggerLog(logId, {
        status: "aborted",
        durationMs: Date.now() - startedAtMs,
        configCount: null,
        issueCount: null,
        message: "当前节点不是 leader，跳过本次触发",
      });
      return NextResponse.json({
        ok: false,
        skipped: true,
        reason: "当前节点不是 leader",
      }, {status: 202});
    }

    if (globalThis.__checkCxPollerRunning) {
      await finishTriggerLog(logId, {
        status: "aborted",
        durationMs: Date.now() - startedAtMs,
        configCount: null,
        issueCount: null,
        message: "已有检查任务正在执行",
      });
      return NextResponse.json({
        ok: false,
        skipped: true,
        reason: "已有检查任务正在执行",
      }, {status: 202});
    }

    globalThis.__checkCxPollerRunning = true;
    setPollerRunning(true);
    setLastPingStartedAt(startedAtMs);
    ownsRunLock = true;

    const failOnIssues = body.failOnIssues !== false;

    const configs = await loadConfigsByIds(ids);

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

    // 全量计划由队列执行；防止旧 Token 调用路径重新耗尽单次请求额度。
    if (configs.length > 300) {
      await finishTriggerLog(logId, {
        status: "aborted", durationMs: Date.now() - startedAtMs,
        configCount: 0, issueCount: 0, message: "同步检测最多 300 个配置，请使用队列调度",
      });
      return NextResponse.json({error: "同步检测最多 300 个配置，请使用队列调度"}, {status: 422});
    }
    const results = await runChecksForConfigs(configs, {strictPersistence: true});
    await runOfficialStatusCheckOnce();

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
  } finally {
    if (ownsRunLock) {
      await releasePollerLeadership();
      globalThis.__checkCxPollerRunning = false;
      setPollerRunning(false);
    }
  }
}
