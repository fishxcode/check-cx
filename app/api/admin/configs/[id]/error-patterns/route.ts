import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 错误类别定义
 */
type ErrorCategory = "network" | "auth" | "rate_limit" | "model" | "validation" | "unknown";

/**
 * 建议严重程度
 */
type RecommendationSeverity = "critical" | "high" | "medium" | "low";

/**
 * 错误模式
 */
interface ErrorPattern {
  id: string;
  pattern: string;
  category: ErrorCategory;
  count: number;
  percentage: number;
  firstSeen: string;
  lastSeen: string;
  affectedConfigs: string[];
}

/**
 * 修复建议
 */
interface Recommendation {
  title: string;
  description: string;
  severity: RecommendationSeverity;
  category: string;
  actionItems: string[];
}

/**
 * 失败原因统计
 */
interface FailureReason {
  reason: string;
  count: number;
  percentage: number;
}

/**
 * 错误模式分析结果
 */
interface ErrorPatternAnalysis {
  period: "7d" | "15d" | "30d";
  totalErrors: number;
  patterns: ErrorPattern[];
  recommendations: Recommendation[];
  topFailureReasons: FailureReason[];
}

/**
 * 认证检查
 */
async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

/**
 * 标准化错误消息，去除动态部分（时间戳、ID 等）
 */
function normalizeErrorMessage(message: string): string {
  if (!message) return "未知错误";

  return message
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*Z?/g, "<timestamp>")
    .replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, "<uuid>")
    .replace(/\b[0-9a-fA-F]{24,}\b/g, "<id>")
    .replace(/\d+ms/g, "<ms>")
    .replace(/\d+s/g, "<s>")
    .replace(/after \d+/g, "after <n>")
    .trim();
}

/**
 * 根据错误消息判断错误类别
 */
function categorizeError(message: string): ErrorCategory {
  const lower = message.toLowerCase();

  if (
    lower.includes("dns") ||
    lower.includes("connection") ||
    lower.includes("timeout") ||
    lower.includes("network") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound")
  ) {
    return "network";
  }

  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("invalid") && lower.includes("key") ||
    lower.includes("authentication")
  ) {
    return "auth";
  }

  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("too many requests")
  ) {
    return "rate_limit";
  }

  if (
    lower.includes("model") ||
    lower.includes("404") && lower.includes("model") ||
    lower.includes("overloaded") ||
    lower.includes("capacity")
  ) {
    return "model";
  }

  if (
    lower.includes("validation") ||
    lower.includes("format") ||
    lower.includes("invalid json") ||
    lower.includes("parse")
  ) {
    return "validation";
  }

  return "unknown";
}

/**
 * 生成修复建议
 */
function generateRecommendations(patterns: ErrorPattern[]): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const pattern of patterns) {
    const rec = generateRecommendationForPattern(pattern);
    if (rec) {
      recommendations.push(rec);
    }
  }

  return recommendations.slice(0, 5);
}

/**
 * 为单个错误模式生成建议
 */
function generateRecommendationForPattern(pattern: ErrorPattern): Recommendation | null {
  const { category, pattern: patternText, count, percentage } = pattern;

  switch (category) {
    case "auth":
      return {
        title: "认证凭据失效",
        description: `检测到 ${count} 次认证错误（占比 ${percentage.toFixed(1)}%）`,
        severity: "critical",
        category: "auth",
        actionItems: [
          "登录 Supabase 检查 check_configs 表中的 api_key 字段",
          "重新生成 API 密钥并更新配置",
          "验证密钥权限是否正确",
        ],
      };

    case "rate_limit":
      return {
        title: "速率限制频繁触发",
        description: `检测到 ${count} 次速率限制错误（占比 ${percentage.toFixed(1)}%）`,
        severity: "high",
        category: "rate_limit",
        actionItems: [
          "增加轮询间隔（CHECK_POLL_INTERVAL_SECONDS）",
          "联系 Provider 升级 API 配额",
          "分散请求到多个配置",
        ],
      };

    case "network":
      return {
        title: "网络连接问题",
        description: `检测到 ${count} 次网络错误（占比 ${percentage.toFixed(1)}%）`,
        severity: patternText.includes("dns") ? "critical" : "high",
        category: "network",
        actionItems: [
          "验证端点 URL 是否正确",
          "检查网络连接和防火墙设置",
          patternText.includes("dns") ? "尝试更换 DNS 服务器" : "检查目标服务是否在线",
        ],
      };

    case "model":
      return {
        title: "模型不可用",
        description: `检测到 ${count} 次模型相关错误（占比 ${percentage.toFixed(1)}%）`,
        severity: "medium",
        category: "model",
        actionItems: [
          "验证模型名称是否正确",
          "检查 Provider 是否支持该模型",
          "联系 Provider 确认模型可用性",
        ],
      };

    case "validation":
      return {
        title: "响应格式错误",
        description: `检测到 ${count} 次验证错误（占比 ${percentage.toFixed(1)}%）`,
        severity: "medium",
        category: "validation",
        actionItems: [
          "检查端点是否返回正确的 JSON 格式",
          "验证 Content-Type 响应头",
          "查看错误详情确认具体问题",
        ],
      };

    default:
      if (percentage > 10) {
        return {
          title: "未分类错误",
          description: `检测到 ${count} 次未分类错误（占比 ${percentage.toFixed(1)}%）`,
          severity: "low",
          category: "unknown",
          actionItems: [
            "查看错误详情确认具体问题",
            "联系技术支持获取帮助",
          ],
        };
      }
      return null;
  }
}

/**
 * 获取时间范围的天数
 */
function getPeriodDays(period: string): number {
  switch (period) {
    case "7d":
      return 7;
    case "15d":
      return 15;
    case "30d":
      return 30;
    default:
      return 7;
  }
}

/**
 * GET /api/admin/configs/[id]/error-patterns
 * 获取指定配置的错误模式分析
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get("period") || "7d") as "7d" | "15d" | "30d";

  if (!["7d", "15d", "30d"].includes(period)) {
    return NextResponse.json({ error: "无效的时间范围，支持 7d/15d/30d" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const days = getPeriodDays(period);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: historyData, error: historyError } = await admin
      .from("check_history")
      .select("config_id, status, message, checked_at")
      .eq("config_id", id)
      .gte("checked_at", startDate)
      .in("status", ["failed", "degraded"])
      .order("checked_at", { ascending: false });

    if (historyError) {
      return NextResponse.json({ error: historyError.message }, { status: 500 });
    }

    const totalErrors = historyData?.length || 0;

    if (totalErrors === 0) {
      return NextResponse.json({
        period,
        totalErrors: 0,
        patterns: [],
        recommendations: [],
        topFailureReasons: [],
      });
    }

    const patternMap = new Map<string, {
      pattern: string;
      category: ErrorCategory;
      count: number;
      firstSeen: string;
      lastSeen: string;
      affectedConfigs: Set<string>;
    }>();

    for (const record of historyData || []) {
      const message = record.message || "未知错误";
      const normalized = normalizeErrorMessage(message);
      const category = categorizeError(message);

      if (!patternMap.has(normalized)) {
        patternMap.set(normalized, {
          pattern: normalized,
          category,
          count: 0,
          firstSeen: record.checked_at,
          lastSeen: record.checked_at,
          affectedConfigs: new Set(),
        });
      }

      const entry = patternMap.get(normalized)!;
      entry.count += 1;
      entry.affectedConfigs.add(record.config_id);

      if (new Date(record.checked_at) < new Date(entry.firstSeen)) {
        entry.firstSeen = record.checked_at;
      }
      if (new Date(record.checked_at) > new Date(entry.lastSeen)) {
        entry.lastSeen = record.checked_at;
      }
    }

    const patterns: ErrorPattern[] = Array.from(patternMap.entries())
      .map(([key, value]) => ({
        id: `pattern-${key.substring(0, 8)}-${value.count}`,
        pattern: value.pattern,
        category: value.category,
        count: value.count,
        percentage: (value.count / totalErrors) * 100,
        firstSeen: value.firstSeen,
        lastSeen: value.lastSeen,
        affectedConfigs: Array.from(value.affectedConfigs),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const recommendations = generateRecommendations(patterns);

    const categoryMap = new Map<string, number>();
    for (const pattern of patterns) {
      const categoryName = getCategoryDisplayName(pattern.category);
      categoryMap.set(categoryName, (categoryMap.get(categoryName) || 0) + pattern.count);
    }

    const topFailureReasons: FailureReason[] = Array.from(categoryMap.entries())
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: (count / totalErrors) * 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const response: ErrorPatternAnalysis = {
      period,
      totalErrors,
      patterns,
      recommendations,
      topFailureReasons,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("错误模式分析失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器错误" },
      { status: 500 }
    );
  }
}

/**
 * 获取错误类别的显示名称
 */
function getCategoryDisplayName(category: ErrorCategory): string {
  const names: Record<ErrorCategory, string> = {
    network: "网络错误",
    auth: "认证失败",
    rate_limit: "速率限制",
    model: "模型错误",
    validation: "验证错误",
    unknown: "未知错误",
  };
  return names[category] || "未知错误";
}

