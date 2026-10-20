/**
 * Check CX 定时检测触发 Worker
 *
 * 由 Cloudflare Cron 每 30 分钟触发，调用 status.fishxcode.com 的检测接口，
 * 让定时检测稳定运行；主站本身不运行常驻后台轮询。
 *
 * 认证：Scheduler Token（在 admin 设置页生成）
 * 行为：触发后始终返回 200（不因检测到 failed 配置而报错），检测结果由接口返回。
 *
 * 触发留痕：每次触发携带 x-cx-trigger 与 x-cx-attempt-id 请求头，
 * 服务端 /api/internal/checks/run 收到后写入 worker_trigger_logs 表，
 * 后台「调度触发」页面可查看记录。
 */

export default {
  /**
   * Cron 定时触发入口
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      triggerChecks(env, "scheduled").then((result) => {
        console.log(`[check-cx-cron] 定时触发完成`, JSON.stringify(result));
      })
    );
  },

  /**
   * 手动触发（可通过 curl 测试）
   * GET / -> 使用 Scheduler Token 触发一次检测
   */
  async fetch(request, env) {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const authorization = request.headers.get("authorization") || "";
    const token = env.SCHEDULER_TOKEN?.trim();
    if (!token || authorization !== `Bearer ${token}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    const result = await triggerChecks(env, "fetch");
    return new Response(JSON.stringify(result, null, 2), {
      headers: { "content-type": "application/json" },
    });
  },
};

/**
 * 调用检测 API 触发一次检测
 * Cron 事件通过 waitUntil 等待完整 API 请求，避免客户端超时导致检查中断。
 */
async function triggerChecks(env, eventType) {
  const base = env.CHECK_CX_API_BASE || "https://status.fishxcode.com";
  const token = env.SCHEDULER_TOKEN;
  if (!token) {
    return { ok: false, error: "SCHEDULER_TOKEN 未配置" };
  }

  const url = `${base}/api/internal/checks/run`;
  const attemptId = crypto.randomUUID();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-CX-Trigger": eventType,
        "X-CX-Attempt-Id": attemptId,
      },
      body: JSON.stringify({ failOnIssues: false }),
    });

    return {
      ok: response.ok,
      status: response.status,
      attemptId,
      body: await response.text(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, attemptId, error: message };
  }
}
