/**
 * Check CX 定时检测触发 Worker
 *
 * 由 Cloudflare Cron 每 30 分钟触发，调用 status.fishxcode.com 的检测接口，
 * 让定时检测稳定运行（Vercel 免费版 Cron 限制每天 2 次，CF Worker 无此限制）。
 *
 * 认证：Scheduler Token（在 admin 设置页生成）
 * 行为：触发后始终返回 200（不因检测到 failed 配置而报错），检测结果由接口返回。
 */

export default {
  /**
   * Cron 定时触发入口
   */
  async scheduled(event, env, ctx) {
    const result = await triggerChecks(env);
    console.log(`[check-cx-cron] 定时触发完成`, JSON.stringify(result));
  },

  /**
   * 手动触发（可通过 curl 测试）
   * GET / -> 触发一次检测
   */
  async fetch(request, env) {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const result = await triggerChecks(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { "content-type": "application/json" },
    });
  },
};

/**
 * 调用检测 API 触发一次检测
 * 说明：检测在 Vercel 端执行较慢（30-60s），超出 CF Worker 免费版 30s 超时。
 * 因此这里发出请求后即返回（不等待检测完成），检测在服务端异步进行。
 */
async function triggerChecks(env) {
  const base = env.CHECK_CX_API_BASE || "https://status.fishxcode.com";
  const token = env.SCHEDULER_TOKEN;
  if (!token) {
    return { ok: false, error: "SCHEDULER_TOKEN 未配置" };
  }

  const url = `${base}/api/internal/checks/run`;
  try {
    // 发起请求但不等待响应体完整读取；设置 AbortController 5 秒后中止（仅等连接/首包）
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ failOnIssues: false }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return {
      ok: true,
      status: response.status,
      note: "请求已发出，检测在服务端异步进行（可能尚未完成）",
    };
  } catch (error) {
    // abort 是预期的（检测在服务端继续执行），视为已触发成功
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("abort") || message.includes("Abort")) {
      return { ok: true, note: "请求已发出（等待连接后被中止），检测在服务端进行" };
    }
    return { ok: false, error: message };
  }
}
