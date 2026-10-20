/** Cron 负责计划与补偿；每条 Queue 消息只执行一个持久化任务。 */
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env, "scheduled").then((result) => {
      console.log("[check-cx-queue] 调度完成", result);
    }));
  },

  async fetch(request, env) {
    if (request.method !== "GET") return new Response("Method Not Allowed", {status: 405});
    const token = env.SCHEDULER_TOKEN?.trim();
    if (!token || request.headers.get("authorization") !== `Bearer ${token}`) {
      return new Response("Unauthorized", {status: 401});
    }
    try {
      return Response.json(await dispatch(env, "fetch"));
    } catch {
      return Response.json({ok: false, error: "创建检测计划失败"}, {status: 503});
    }
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      const taskId = message.body?.taskId;
      if (typeof taskId !== "string" || !/^[0-9a-f-]{36}$/i.test(taskId)) {
        console.error("[check-cx-queue] 无效任务消息");
        message.ack();
        continue;
      }
      try {
        const result = await callApi(env, {action: "execute", taskId});
        // 先发送已持久化的后续任务，再确认当前消息；发送失败可安全重放。
        await enqueue(env, result.tasks);
        if (result.retry) message.retry({delaySeconds: 60});
        else {
          if (result.failed) console.error("[check-cx-queue] 任务已失败", {taskId});
          message.ack();
        }
      } catch (error) {
        console.error("[check-cx-queue] 等待重试", {taskId, error: error instanceof Error ? error.message : "未知错误"});
        message.retry({delaySeconds: 60});
      }
    }
  },
};

async function dispatch(env, event) {
  // 数据库统一判断检测周期；手动请求同样不会绕过到期与防重检查。
  const result = await callApi(env, {action: "dispatch", event});
  await enqueue(env, result.tasks);
  return {ok: true, attemptId: result.attemptId, intervalSeconds: result.intervalSeconds, queued: result.tasks.length};
}

async function callApi(env, body) {
  const token = env.SCHEDULER_TOKEN?.trim();
  if (!token) throw new Error("SCHEDULER_TOKEN 未配置");
  const base = env.CHECK_CX_API_BASE || "https://status.fishxcode.com";
  const response = await fetch(`${base}/api/internal/checks/queue`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(90_000),
    headers: {"Content-Type": "application/json", Authorization: `Bearer ${token}`},
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`任务接口返回 HTTP ${response.status}`);
  const result = await response.json();
  if (!Array.isArray(result.tasks)) throw new Error("任务接口未返回有效计划");
  return result;
}

async function enqueue(env, taskIds) {
  if (!env.CHECK_QUEUE) throw new Error("CHECK_QUEUE 未绑定");
  // 每个 sendBatch 最多 100 条，每次调用不会发出 200 个 HTTP 请求。
  for (let offset = 0; offset < taskIds.length; offset += 100) {
    await env.CHECK_QUEUE.sendBatch(taskIds.slice(offset, offset + 100).map((taskId) => ({
      body: {taskId}, contentType: "json",
    })));
  }
}
