/**
 * 后台轮询器
 * 在应用启动时自动初始化并持续运行
 */

import { appendHistory } from "../database/history";
import { loadProviderConfigsFromDB } from "../database/config-loader";
import { runProviderChecks } from "../providers";
import { getPollingIntervalMs } from "./polling-config";
import {
  getPollerTimer,
  setPollerTimer,
  isPollerRunning,
  setPollerRunning,
  getLastPingStartedAt,
  setLastPingStartedAt,
} from "./global-state";
import type { HealthStatus } from "../types";

const POLL_INTERVAL_MS = getPollingIntervalMs();

/**
 * 执行一次轮询检查
 */
async function tick() {
  if (isPollerRunning()) {
    const lastStartedAt = getLastPingStartedAt();
    const duration = lastStartedAt ? Date.now() - lastStartedAt : null;
    console.log(
      `[check-cx] 跳过 ping：上一轮仍在执行${
        duration !== null ? `（已耗时 ${duration}ms）` : ""
      }`
    );
    return;
  }

  const startedAt = Date.now();
  setLastPingStartedAt(startedAt);
  console.log(
    `[check-cx] 后台 ping 开始 · ${new Date(
      startedAt
    ).toISOString()} · interval=${POLL_INTERVAL_MS}ms`
  );

  setPollerRunning(true);
  try {
    const configs = await loadProviderConfigsFromDB();
    if (configs.length === 0) {
      console.log(`[check-cx] 数据库中未找到启用的配置，本轮 ping 结束`);
      return;
    }

    const results = await runProviderChecks(configs);

    console.log("[check-cx] 本轮检测明细：");
    results.forEach((result) => {
      const latency =
        typeof result.latencyMs === "number" ? `${result.latencyMs}ms` : "N/A";
      const sanitizedMessage = (result.message || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      console.log(
        `[check-cx]   · ${result.name}(${result.type}/${result.model}) -> ${
          result.status
        } | latency=${latency} | endpoint=${result.endpoint} | message=${
          sanitizedMessage || "无"
        }`
      );
    });

    console.log(`[check-cx] 正在写入历史记录（${results.length} 条）…`);
    const historySnapshot = await appendHistory(results);
    const providerCount = Object.keys(historySnapshot).length;
    const recordCount = Object.values(historySnapshot).reduce(
      (total, items) => total + items.length,
      0
    );
    console.log(
      `[check-cx] 历史记录更新完成：providers=${providerCount}，总记录=${recordCount}`
    );

    const statusCounts: Record<HealthStatus, number> = {
      operational: 0,
      degraded: 0,
      failed: 0,
    };
    results.forEach((result) => {
      statusCounts[result.status] += 1;
    });

    const elapsed = Date.now() - startedAt;
    const nextSchedule = new Date(startedAt + POLL_INTERVAL_MS).toISOString();

    console.log(
      `[check-cx] 本轮 ping 完成，用时 ${elapsed}ms；operational=${
        statusCounts.operational
      } degraded=${statusCounts.degraded} failed=${
        statusCounts.failed
      }。下次预计 ${nextSchedule}`
    );
  } catch (error) {
    console.error("[check-cx] 轮询检测失败", error);
  } finally {
    setPollerRunning(false);
  }
}

// 自动初始化轮询器
if (!getPollerTimer()) {
  console.log(`[check-cx] 初始化后台轮询器，interval=${POLL_INTERVAL_MS}ms`);
  tick().catch((error) => console.error("[check-cx] 初次检测失败", error));
  const timer = setInterval(() => {
    tick().catch((error) => console.error("[check-cx] 定时检测失败", error));
  }, POLL_INTERVAL_MS);
  setPollerTimer(timer);
}
