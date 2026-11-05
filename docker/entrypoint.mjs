import {spawn} from "node:child_process";

const port = process.env.PORT ?? "3000";
const child = spawn(process.execPath, [".output/server/index.mjs"], {
  stdio: "inherit",
  // 容器固定以生产模式运行，避免 --env-file 里的 NODE_ENV=development 意外带进来。
  env: {...process.env, NODE_ENV: "production", PORT: port},
});
child.on("exit", (code) => process.exit(code ?? 1));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 容器内自带执行循环：配置 SCHEDULER_TOKEN（后台创建的调度 Token 明文）后，
 * 连续调用 pump 直到队列没有可推进的任务，空闲时按 PUMP_INTERVAL_MS 轮询，
 * 不再依赖 Cloudflare Worker / Vercel Cron。
 */
const token = process.env.SCHEDULER_TOKEN;
if (!token) {
  console.warn("[entrypoint] 未配置 SCHEDULER_TOKEN，容器内执行循环未启用，队列仍依赖外部触发器调用 pump");
} else {
  const rawIdle = Number(process.env.PUMP_INTERVAL_MS ?? 300_000);
  // 非数字或过小会变成高频空转，这里兜底到 5 分钟，最小 60 秒。
  const idleIntervalMs = Number.isFinite(rawIdle) && rawIdle >= 60_000 ? rawIdle : 300_000;
  // 连续推进上限：达到后强制让出几秒，避免异常任务导致空转。
  const MAX_CONSECUTIVE = 20;

  const pumpOnce = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/internal/checks/pump`, {
      method: "POST",
      headers: {authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      console.error(`[entrypoint] pump HTTP ${response.status}`);
      return {busy: false, hasWork: false};
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      // 非 JSON 响应按没活处理，下一轮重新判断。
    }
    const dispatched = Number(data?.dispatched ?? 0);
    const followUpTasks = Number(data?.followUpTasks ?? 0);
    return {
      busy: Boolean(data?.skipped),
      hasWork: dispatched > 0 || followUpTasks > 0,
    };
  };

  const loop = async () => {
    // 留出服务启动时间。
    await sleep(15_000);
    let consecutive = 0;

    while (true) {
      try {
        const {busy, hasWork} = await pumpOnce();
        if (hasWork) {
          consecutive += 1;
          if (consecutive >= MAX_CONSECUTIVE) {
            consecutive = 0;
            await sleep(5_000);
          }
          continue;
        }
        consecutive = 0;
        // skipped 表示别的实例持有租约，短暂等待后再试；否则按空闲间隔轮询。
        await sleep(busy ? 30_000 : idleIntervalMs);
      } catch (error) {
        console.error("[entrypoint] pump 调用失败", error instanceof Error ? error.message : error);
        consecutive = 0;
        await sleep(idleIntervalMs);
      }
    }
  };

  void loop();
  console.log(`[entrypoint] 容器内执行循环已启用：连续推进，空闲间隔 ${idleIntervalMs}ms`);
}
