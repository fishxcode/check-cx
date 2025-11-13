/**
 * 错误处理工具
 */

/**
 * 统一的错误日志记录
 * @param context 错误上下文
 * @param error 错误对象
 */
export function logError(context: string, error: unknown): void {
  console.error(`[check-cx] ${context}:`, error);
}

/**
 * 安全地提取错误消息
 * @param error 错误对象
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "未知错误";
}
