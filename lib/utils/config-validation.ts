/**
 * 配置写入的通用校验/归一化工具，供 POST / PUT / import 等入口统一复用，
 * 避免非法调度值与重复标签绕过前端直接进入数据库。
 */

/** 归一化标签数组：转字符串、去空白、过滤空值、去重 */
export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const item of input) {
    const tag = String(item ?? "").trim();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/**
 * 校验可选整数字段落在闭区间内。
 * - 未提供 / null / 空串 → { value: null }（表示继承全局）
 * - 合法整数 → { value }
 * - 非法 → { error }
 */
export function validateOptionalInt(
  value: unknown,
  min: number,
  max: number
): { value: number | null } | { error: string } {
  if (value === null || value === undefined || value === "") return { value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return { error: `取值需为 ${min}-${max} 之间的整数` };
  }
  return { value };
}

/** 调度字段范围常量，与前端输入控件保持一致 */
export const CHECK_INTERVAL_RANGE = { min: 15, max: 600 } as const;
export const LATENCY_THRESHOLD_RANGE = { min: 1000, max: 60000 } as const;
