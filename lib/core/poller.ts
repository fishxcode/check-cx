/**
 * 后台轮询器
 * 在应用启动时自动初始化并持续运行
 */

import {getPollingIntervalMs} from "./polling-config";
import {getPollerTimer, setPollerTimer,} from "./global-state";
import {startOfficialStatusPoller} from "./official-status-poller";
import {ensurePollerLeadership} from "./poller-leadership";
import {runPollExecution} from "./poll-execution";

async function tick() {
  await runPollExecution({
    forceRefreshConfigs: true,
    source: "background",
  });
}

function shouldAutoStartPoller(): boolean {
  return process.env.VERCEL !== "1";
}

// 自动初始化轮询器（递归 setTimeout，支持动态间隔）
if (shouldAutoStartPoller() && !getPollerTimer()) {
  const scheduleNext = () => {
    const interval = getPollingIntervalMs();
    const timer = setTimeout(() => {
      tick()
        .catch((error) => console.error("[check-cx] 定时检测失败", error))
        .finally(scheduleNext);
    }, interval);
    setPollerTimer(timer as unknown as ReturnType<typeof setInterval>);
  };

  const interval = getPollingIntervalMs();
  console.log(
    `[check-cx] 初始化后台轮询器，interval=${interval}ms，首次检测立即执行`
  );
  ensurePollerLeadership().catch((error) => {
    console.error("[check-cx] 初始化主节点选举失败", error);
  });
  tick()
    .catch((error) => console.error("[check-cx] 启动首轮检测失败", error))
    .finally(scheduleNext);

  // 启动官方状态轮询器
  startOfficialStatusPoller();
}
