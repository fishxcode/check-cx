/**
 * Check CX 定时检测触发 Worker
 *
 * 由 Cloudflare Cron 每小时整点唤醒，POST 到主站的 pump 端点推进检测队列。
 * 主站本身不运行常驻轮询，队列进度完全依赖这里的心跳。
 *
 * 认证：Scheduler Token（admin 后台「调度 API Token」生成）
 *
 * 日志约定：每次触发都打印一行结构化日志，包含 HTTP 状态与响应体片段。
 * Cloudflare 后台 Dashboard → Workers → Logs 可直接看到，便于排查
 * 401（Token 失效）与 503（队列暂不可用）这两类问题。
 */

/**
 * 主动放弃等待的超时时间。
 *
 * pump 一次要执行约 45~60 秒，而 Cloudflare `scheduled` 事件的墙钟上限约 30 秒。
 * 如果在这里 await 到响应返回，Worker 会先被平台杀掉，连带中断到主站的请求。
 * 因此只等一小段时间确认请求已送达，之后主动 abort，把执行留给服务端继续。
 *
 * 超时是预期行为，不是失败：pump 通过数据库租约推进，未执行完的任务
 * 会在下一次心跳被重新投递，不会丢。
 */
const REQUEST_TIMEOUT_MS = 15_000;

export default {
  /** Cron 定时入口。waitUntil 保证请求发出后不被提前回收。 */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      triggerPump(env).then((result) => {
        console.log(`[check-cx-cron] 定时触发完成`, JSON.stringify(result));
      }),
    );
  },

  /**
   * 手动触发（方便用 curl 验证 Token 与域名配置）。
   * GET / -> 使用 SCHEDULER_TOKEN 触发一次，等价于一次 cron 心跳。
   */
  async fetch(request, env) {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const expected = env.SCHEDULER_TOKEN?.trim();
    if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    const result = await triggerPump(env);
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 502,
      headers: { "content-type": "application/json" },
    });
  },
};

/**
 * 调用 pump 推进一轮队列。
 *
 * 约定：
 * - 拿到 2xx 视为已受理；
 * - 超时/abort 同样视为已受理（服务端会继续跑，或由下次心跳补偿）；
 * - 401 说明 Token 失效；5xx 说明服务端队列暂不可用。
 */
async function triggerPump(env) {
  const token = env.SCHEDULER_TOKEN?.trim();
  if (!token) {
    return { ok: false, error: "SCHEDULER_TOKEN 未配置" };
  }

  const base = (env.CHECK_CX_API_BASE || "https://status.fishxcode.com").replace(/\/+$/, "");
  const url = `${base}/api/internal/checks/pump`;

  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: "{}",
    });

    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text.slice(0, 500),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && (error.name === "TimeoutError" || message.includes("abort"))) {
      return { ok: true, note: "请求已送达，服务端继续执行（主动放弃等待）" };
    }
    return { ok: false, error: message };
  }
}
