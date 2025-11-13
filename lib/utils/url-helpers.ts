/**
 * URL 处理工具函数
 */

/**
 * 确保 URL 包含指定路径
 * @param endpoint 端点 URL
 * @param fallbackPath 备用路径
 */
export function ensurePath(endpoint: string, fallbackPath: string): string {
  if (!endpoint) {
    return fallbackPath;
  }
  if (
    endpoint.endsWith(fallbackPath) ||
    endpoint.includes("/v1/") ||
    endpoint.includes("/deployments/") ||
    endpoint.includes("?")
  ) {
    return endpoint;
  }
  return `${endpoint.replace(/\/$/, "")}${fallbackPath}`;
}

/**
 * 向 URL 追加查询参数
 * @param url 原始 URL
 * @param query 查询参数字符串
 */
export function appendQuery(url: string, query: string): string {
  return url.includes("?") ? `${url}&${query}` : `${url}?${query}`;
}

/**
 * 从错误响应体中提取错误信息
 * @param body 响应体文本
 */
export function extractMessage(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body);
    return (
      parsed?.error?.message ||
      parsed?.error ||
      parsed?.message ||
      JSON.stringify(parsed)
    );
  } catch {
    return body.slice(0, 280);
  }
}
