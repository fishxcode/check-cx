/**
 * 单次检测执行器
 * 同时服务于常驻轮询器与无状态 Cron 任务
 */

import {loadProviderConfigsFromDB} from "../database/config-loader";
import {isConfigPaused, isConfigDue, updateNextCheckAt} from "../database/config-scheduler";
import {getLastPingStartedAt, setLastPingStartedAt, setPollerRunning} from "./global-state";
import {ensurePollerLeadership, isPollerLeader} from "./poller-leadership";
import {getPollingIntervalMs} from "./polling-config";
import {refreshSiteSettings} from "./site-settings";
import type {CheckResult, HealthStatus} from "../types";
import {runChecksForConfigs} from "./config-check-execution";

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

export async function getScheduledCheckDecision(): Promise<PollScheduleDecision> {
  // 与 runPollExecution 使用同一套 next_check_at 驱动的每配置调度，避免决策与执行双轨不一致。
  // 只要存在一个「启用 且 未暂停 且 已到期」的配置即判定 due。
  const allConfigs = await loadProviderConfigsFromDB({forceRefresh: true});
  const now = Date.now();
  const activeConfigs = allConfigs.filter(
    (cfg) => !cfg.is_maintenance && !isConfigPaused(cfg.pausedUntil, now)
  );

  if (activeConfigs.length === 0) {
    return {due: false, reason: "没有可执行的启用配置", lastCheckedAt: null};
  }

  const dueConfig = activeConfigs.find((cfg) => isConfigDue(cfg.nextCheckAt, now));
  if (dueConfig) {
    return {
      due: true,
      reason: dueConfig.nextCheckAt
        ? `配置 ${dueConfig.name} 已到期（next_check_at=${dueConfig.nextCheckAt}）`
        : `配置 ${dueConfig.name} 尚未调度过（next_check_at 为空）`,
      lastCheckedAt: null,
    };
  }

  // 全部未到期：返回最近的下次检查时间供调用方观测
  const earliestNext = activeConfigs
    .map((cfg) => cfg.nextCheckAt)
    .filter((v): v is string => Boolean(v))
    .sort()[0] ?? null;

  return {
    due: false,
    reason: "所有配置均未到下次检查时间",
    lastCheckedAt: earliestNext,
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
    const now = Date.now();
    // 过滤：维护中、暂停中、未到期（自定义间隔）的配置均跳过
    const configs = allConfigs.filter(
      (cfg) =>
        !cfg.is_maintenance &&
        !isConfigPaused(cfg.pausedUntil, now) &&
        isConfigDue(cfg.nextCheckAt, now)
    );

    if (configs.length === 0) {
      console.log("[check-cx] 数据库中未找到可执行的启用配置");
      return buildSkippedResult(source, "没有可执行的启用配置", startedAtMs, allConfigs.length);
    }

    const results = await runChecksForConfigs(configs);

    // 更新每个配置的下次检查时间（自定义间隔覆盖全局间隔）
    const globalIntervalMs = getPollingIntervalMs();
    await Promise.all(
      configs.map((cfg) => {
        const intervalMs =
          cfg.checkIntervalOverride && cfg.checkIntervalOverride > 0
            ? cfg.checkIntervalOverride * 1000
            : globalIntervalMs;
        const nextCheckAt = new Date(Date.now() + intervalMs).toISOString();
        return updateNextCheckAt(cfg.id, nextCheckAt);
      })
    );

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
