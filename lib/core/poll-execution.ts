/**
 * 单次检测执行器
 * 同时服务于常驻轮询器与无状态 Cron 任务
 */

import {historySnapshotStore} from "../database/history";
import {loadProviderConfigsFromDB} from "../database/config-loader";
import {clearAvailabilityStatsCache} from "../database/availability";
import {runProviderChecks} from "../providers";
import {evaluateAlerts} from "./alert-engine";
import {getLastPingStartedAt, setLastPingStartedAt, setPollerRunning} from "./global-state";
import {ensurePollerLeadership, isPollerLeader} from "./poller-leadership";
import {getPollingIntervalMs} from "./polling-config";
import {sendPollSummary} from "./poll-summary";
import {refreshSiteSettings} from "./site-settings";
import type {CheckResult, HealthStatus} from "../types";

export interface PollExecutionOptions {
  forceRefreshConfigs?: boolean;
  skipLeadership?: boolean;
  source?: string;
}

export interface PollScheduleDecision {
  due: boolean;
  reason: string;
  lastCheckedAt: string | null;
}

export interface PollExecutionResult {
  executed: boolean;
  reason: string;
  source: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalConfigs: number;
  checkedConfigs: number;
  providerCount: number;
  statusCounts: Record<HealthStatus, number>;
}

function createEmptyStatusCounts(): Record<HealthStatus, number> {
  return {
    operational: 0,
    degraded: 0,
    failed: 0,
    validation_failed: 0,
    maintenance: 0,
    error: 0,
  };
}

function buildSkippedResult(
  source: string,
  reason: string,
  startedAtMs: number,
  totalConfigs: number = 0
): PollExecutionResult {
  const finishedAtMs = Date.now();
  return {
    executed: false,
    reason,
    source,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    totalConfigs,
    checkedConfigs: 0,
    providerCount: 0,
    statusCounts: createEmptyStatusCounts(),
  };
}

export async function getScheduledCheckDecision(
  pollIntervalMs: number = getPollingIntervalMs()
): Promise<PollScheduleDecision> {
  const allConfigs = await loadProviderConfigsFromDB({forceRefresh: true});
  const activeConfigs = allConfigs.filter((cfg) => !cfg.is_maintenance);

  if (activeConfigs.length === 0) {
    return {
      due: false,
      reason: "没有可执行的启用配置",
      lastCheckedAt: null,
    };
  }

  const history = await historySnapshotStore.fetch({
    allowedIds: activeConfigs.map((config) => config.id),
    limitPerConfig: 1,
  });

  let oldestCheckedAtMs = Number.POSITIVE_INFINITY;
  let oldestCheckedAt: string | null = null;

  for (const config of activeConfigs) {
    const latest = history[config.id]?.[0];
    if (!latest) {
      return {
        due: true,
        reason: `配置 ${config.name} 缺少历史记录`,
        lastCheckedAt: null,
      };
    }

    const checkedAtMs = Date.parse(latest.checkedAt);
    if (!Number.isFinite(checkedAtMs)) {
      return {
        due: true,
        reason: `配置 ${config.name} 的最近检查时间无效`,
        lastCheckedAt: latest.checkedAt,
      };
    }

    if (checkedAtMs < oldestCheckedAtMs) {
      oldestCheckedAtMs = checkedAtMs;
      oldestCheckedAt = latest.checkedAt;
    }
  }

  if (!Number.isFinite(oldestCheckedAtMs)) {
    return {
      due: true,
      reason: "无法确定最近检查时间",
      lastCheckedAt: oldestCheckedAt,
    };
  }

  const elapsed = Date.now() - oldestCheckedAtMs;
  if (elapsed >= pollIntervalMs) {
    return {
      due: true,
      reason: `最近一次检查距今 ${elapsed}ms，超过阈值 ${pollIntervalMs}ms`,
      lastCheckedAt: oldestCheckedAt,
    };
  }

  return {
    due: false,
    reason: `最近一次检查距今 ${elapsed}ms，未达到阈值 ${pollIntervalMs}ms`,
    lastCheckedAt: oldestCheckedAt,
  };
}

export async function runPollExecution(
  options: PollExecutionOptions = {}
): Promise<PollExecutionResult> {
  const source = options.source ?? "background";

  await refreshSiteSettings().catch(() => {});

  const startedAtMs = Date.now();

  if (!options.skipLeadership) {
    try {
      await ensurePollerLeadership();
    } catch (error) {
      console.error("[check-cx] 主节点选举失败，跳过本轮检测", error);
      return buildSkippedResult(source, "主节点选举失败", startedAtMs);
    }

    if (!isPollerLeader()) {
      console.log("[check-cx] 当前节点为 standby，跳过本轮检测");
      return buildSkippedResult(source, "当前节点不是 leader", startedAtMs);
    }
  }

  if (globalThis.__checkCxPollerRunning) {
    const lastStartedAt = getLastPingStartedAt();
    const duration = lastStartedAt ? Date.now() - lastStartedAt : null;
    const message =
      duration !== null
        ? `上一轮检测仍在执行（已耗时 ${duration}ms）`
        : "上一轮检测仍在执行";
    console.log(`[check-cx] 跳过检测：${message}`);
    return buildSkippedResult(source, message, startedAtMs);
  }

  globalThis.__checkCxPollerRunning = true;
  setPollerRunning(true);
  setLastPingStartedAt(startedAtMs);

  const pollIntervalMs = getPollingIntervalMs();
  console.log(
    `[check-cx] 开始执行检测 · source=${source} · ${new Date(
      startedAtMs
    ).toISOString()} · interval=${pollIntervalMs}ms`
  );

  try {
    const allConfigs = await loadProviderConfigsFromDB({
      forceRefresh: options.forceRefreshConfigs,
    });
    const configs = allConfigs.filter((cfg) => !cfg.is_maintenance);

    if (configs.length === 0) {
      console.log("[check-cx] 数据库中未找到可执行的启用配置");
      return buildSkippedResult(source, "没有可执行的启用配置", startedAtMs, allConfigs.length);
    }

    const results = await runProviderChecks(configs);

    console.log("[check-cx] 本轮检测明细：");
    results.forEach((result) => {
      const latency =
        typeof result.latencyMs === "number" ? `${result.latencyMs}ms` : "N/A";
      const pingLatency =
        typeof result.pingLatencyMs === "number"
          ? `${result.pingLatencyMs}ms`
          : "N/A";
      const sanitizedMessage = (result.message || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      console.log(
        `[check-cx]   · ${result.name}(${result.type}/${result.model}) -> ${
          result.status
        } | latency=${latency} | ping=${pingLatency} | endpoint=${
          result.endpoint
        } | message=${sanitizedMessage || "无"}`
      );
    });

    console.log(`[check-cx] 正在写入历史记录（${results.length} 条）…`);
    await historySnapshotStore.append(results);
    clearAvailabilityStatsCache();
    await Promise.allSettled(
      results.map((result) =>
        evaluateAlerts(result.id, result.name, result.status, result.latencyMs ?? null)
      )
    );
    await sendPollSummary(results).catch((error) =>
      console.error("[check-cx] 汇总推送失败", error)
    );

    return buildExecutedResult(source, startedAtMs, allConfigs.length, results);
  } catch (error) {
    console.error("[check-cx] 执行检测失败", error);
    return buildSkippedResult(source, "执行检测失败", startedAtMs);
  } finally {
    globalThis.__checkCxPollerRunning = false;
    setPollerRunning(false);
  }
}

function buildExecutedResult(
  source: string,
  startedAtMs: number,
  totalConfigs: number,
  results: CheckResult[]
): PollExecutionResult {
  const finishedAtMs = Date.now();
  const statusCounts = createEmptyStatusCounts();
  results.forEach((result) => {
    statusCounts[result.status] += 1;
  });

  const providerCount = new Set(results.map((item) => item.id)).size;
  const nextSchedule = new Date(startedAtMs + getPollingIntervalMs()).toISOString();
  console.log(
    `[check-cx] 本轮检测完成，用时 ${finishedAtMs - startedAtMs}ms；operational=${
      statusCounts.operational
    } degraded=${statusCounts.degraded} failed=${statusCounts.failed} error=${
      statusCounts.error
    }。下次预计 ${nextSchedule}`
  );

  return {
    executed: true,
    reason: "检测完成",
    source,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    totalConfigs,
    checkedConfigs: results.length,
    providerCount,
    statusCounts,
  };
}
