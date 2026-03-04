/**
 * 基于内存的滑动窗口限速器
 *
 * 适用于单节点部署（Next.js 进程级共享）。
 * 多节点部署需改用 Redis（Upstash）等外部存储。
 */

interface WindowEntry {
  count: number;
  windowStart: number;
}

// 按路由前缀配置限速规则
interface RateLimitRule {
  maxRequests: number; // 窗口内最大请求数
  windowMs: number;    // 窗口时长（毫秒）
}

const store = new Map<string, WindowEntry>();

// 每 5 分钟清理一次过期条目，防止内存泄漏
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.windowStart > 120_000) {
        store.delete(key);
      }
    }
  },
  5 * 60 * 1000
);

/**
 * 检查并记录请求，返回限速结果
 *
 * @param ip      客户端 IP
 * @param route   路由标识（用于隔离不同接口的计数）
 * @param rule    限速规则
 * @returns { allowed, remaining, resetMs }
 */
export function checkRateLimit(
  ip: string,
  route: string,
  rule: RateLimitRule
): { allowed: boolean; remaining: number; resetMs: number } {
  const key = `${route}:${ip}`;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= rule.windowMs) {
    // 新窗口
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: rule.maxRequests - 1, resetMs: rule.windowMs };
  }

  if (entry.count >= rule.maxRequests) {
    const resetMs = rule.windowMs - (now - entry.windowStart);
    return { allowed: false, remaining: 0, resetMs };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: rule.maxRequests - entry.count,
    resetMs: rule.windowMs - (now - entry.windowStart),
  };
}

/** 公开 Dashboard API 限速规则：60 次 / 分钟 */
export const DASHBOARD_RATE_LIMIT: RateLimitRule = {
  maxRequests: 60,
  windowMs: 60_000,
};
