import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProviderConfig, ProviderType } from "@/lib/types";
import { runProviderChecks } from "@/lib/providers";
import { assertEndpointSafe } from "@/lib/utils/ssrf-guard";
import * as dns from "dns/promises";
import * as tls from "tls";
import { URL } from "url";

/**
 * 诊断层级状态
 */
type DiagnosticLayerStatus = "success" | "warning" | "failed" | "skipped";

/**
 * 诊断整体状态
 */
type DiagnosticOverallStatus = "success" | "partial" | "failed";

/**
 * 诊断层级结果
 */
interface DiagnosticLayer {
  name: string;
  status: DiagnosticLayerStatus;
  startTime: number;
  endTime: number;
  durationMs: number | null;
  message: string | null;
  details: Record<string, unknown> | null;
}

/**
 * 诊断结果
 */
interface DiagnosticResult {
  id: string;
  configId: string;
  configName: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  overallStatus: DiagnosticOverallStatus;
  layers: {
    dns: DiagnosticLayer;
    tls: DiagnosticLayer;
    ttfb: DiagnosticLayer;
    api: DiagnosticLayer;
    validation: DiagnosticLayer;
  };
  recommendations: string[];
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
 * DNS 解析诊断
 */
async function diagnoseDNS(endpoint: string): Promise<DiagnosticLayer> {
  const startTime = Date.now();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(endpoint);
  } catch {
    return {
      name: "DNS 解析",
      status: "failed",
      startTime: 0,
      endTime: Date.now() - startTime,
      durationMs: Date.now() - startTime,
      message: "无效的 URL 格式",
      details: { endpoint },
    };
  }

  try {
    const addresses = await dns.resolve(parsedUrl.hostname);
    const durationMs = Date.now() - startTime;

    return {
      name: "DNS 解析",
      status: "success",
      startTime: 0,
      endTime: durationMs,
      durationMs,
      message: "解析成功",
      details: {
        hostname: parsedUrl.hostname,
        addresses,
        recordType: "A",
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      name: "DNS 解析",
      status: "failed",
      startTime: 0,
      endTime: durationMs,
      durationMs,
      message: error instanceof Error ? error.message : "DNS 解析失败",
      details: { hostname: parsedUrl.hostname },
    };
  }
}

/**
 * TLS 握手诊断
 */
async function diagnoseTLS(endpoint: string, previousEndTime: number): Promise<DiagnosticLayer> {
  const startTime = Date.now();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(endpoint);
  } catch {
    return {
      name: "TLS 握手",
      status: "skipped",
      startTime: previousEndTime,
      endTime: previousEndTime,
      durationMs: null,
      message: "无效的 URL 格式",
      details: null,
    };
  }

  if (parsedUrl.protocol !== "https:") {
    return {
      name: "TLS 握手",
      status: "skipped",
      startTime: previousEndTime,
      endTime: previousEndTime,
      durationMs: null,
      message: "非 HTTPS 端点，跳过 TLS 检查",
      details: null,
    };
  }

  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: parsedUrl.hostname,
        port: 443,
        servername: parsedUrl.hostname,
        timeout: 8000,
      },
      () => {
        const cert = socket.getPeerCertificate();
        const durationMs = Date.now() - startTime;
        const validTo = new Date(cert.valid_to);
        const daysUntilExpiry = Math.floor((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

        socket.end();

        const isExpiringSoon = daysUntilExpiry <= 30;

        resolve({
          name: "TLS 握手",
          status: socket.authorized ? (isExpiringSoon ? "warning" : "success") : "failed",
          startTime: previousEndTime,
          endTime: previousEndTime + durationMs,
          durationMs,
          message: socket.authorized
            ? isExpiringSoon
              ? `证书将在 ${daysUntilExpiry} 天内过期`
              : "证书有效"
            : "证书未授权",
          details: {
            authorized: socket.authorized,
            validFrom: cert.valid_from,
            validTo: cert.valid_to,
            issuer: cert.issuer?.O || "Unknown",
            daysUntilExpiry: isExpiringSoon ? daysUntilExpiry : undefined,
          },
        });
      }
    );

    socket.on("error", (error) => {
      const durationMs = Date.now() - startTime;
      socket.destroy();
      resolve({
        name: "TLS 握手",
        status: "failed",
        startTime: previousEndTime,
        endTime: previousEndTime + durationMs,
        durationMs,
        message: error.message,
        details: { error: error.message },
      });
    });

    socket.setTimeout(8000, () => {
      socket.destroy();
      const durationMs = Date.now() - startTime;
      resolve({
        name: "TLS 握手",
        status: "failed",
        startTime: previousEndTime,
        endTime: previousEndTime + durationMs,
        durationMs,
        message: "握手超时",
        details: null,
      });
    });
  });
}

/**
 * TTFB 测量诊断
 */
async function measureTTFB(endpoint: string, previousEndTime: number): Promise<DiagnosticLayer> {
  const startTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(endpoint, {
      method: "HEAD",
      signal: controller.signal,
    });

    const durationMs = Date.now() - startTime;

    return {
      name: "TTFB 测量",
      status: durationMs <= 2000 ? "success" : "warning",
      startTime: previousEndTime,
      endTime: previousEndTime + durationMs,
      durationMs,
      message: durationMs <= 2000 ? "响应正常" : "响应较慢",
      details: {
        ttfb: durationMs,
        statusCode: response.status,
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      name: "TTFB 测量",
      status: "failed",
      startTime: previousEndTime,
      endTime: previousEndTime + durationMs,
      durationMs,
      message: error instanceof Error ? error.message : "请求失败",
      details: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * API 响应校验
 */
async function validateAPIResponse(
  config: ProviderConfig,
  previousEndTime: number
): Promise<DiagnosticLayer> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (config.type === "openai" || config.type === "grok") {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    } else if (config.type === "anthropic") {
      headers["x-api-key"] = config.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    }

    if (config.requestHeaders) {
      Object.assign(headers, config.requestHeaders);
    }

    const body: Record<string, unknown> = {
      model: config.model,
      stream: false,
      max_tokens: 1,
    };

    if (config.type === "openai" || config.type === "grok") {
      body.messages = [{ role: "user", content: "test" }];
    } else if (config.type === "anthropic") {
      body.messages = [{ role: "user", content: "test" }];
    } else if (config.type === "gemini") {
      body.contents = [{ parts: [{ text: "test" }] }];
    }

    const response = await fetch(config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const durationMs = Date.now() - startTime;

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    let responseSize = 0;
    try {
      const text = await response.text();
      responseSize = text.length;
      if (isJson) {
        JSON.parse(text);
      }
    } catch {
      return {
        name: "API 响应",
        status: "failed",
        startTime: previousEndTime,
        endTime: previousEndTime + durationMs,
        durationMs,
        message: "响应非有效 JSON",
        details: {
          statusCode: response.status,
          contentType,
          isValidJson: false,
        },
      };
    }

    return {
      name: "API 响应",
      status: response.ok ? "success" : "failed",
      startTime: previousEndTime,
      endTime: previousEndTime + durationMs,
      durationMs,
      message: response.ok ? "响应格式正确" : `HTTP ${response.status}`,
      details: {
        statusCode: response.status,
        contentType,
        responseSize,
        isValidJson: isJson,
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      name: "API 响应",
      status: "failed",
      startTime: previousEndTime,
      endTime: previousEndTime + durationMs,
      durationMs,
      message: error instanceof Error ? error.message : "请求失败",
      details: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 内容验证诊断（数学挑战）
 */
async function validateContent(
  config: ProviderConfig,
  previousEndTime: number
): Promise<DiagnosticLayer> {
  const startTime = Date.now();

  try {
    const [result] = await runProviderChecks([config]);
    const durationMs = Date.now() - startTime;

    return {
      name: "内容验证",
      status: result.status === "operational" ? "success" : "failed",
      startTime: previousEndTime,
      endTime: previousEndTime + durationMs,
      durationMs,
      message:
        result.status === "operational"
          ? "答案验证通过"
          : result.message || "验证失败",
      details: {
        firstTokenLatency: result.latencyMs,
        totalLatency: durationMs,
        answerCorrect: result.status === "operational",
        status: result.status,
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      name: "内容验证",
      status: "failed",
      startTime: previousEndTime,
      endTime: previousEndTime + durationMs,
      durationMs,
      message: error instanceof Error ? error.message : "验证失败",
      details: null,
    };
  }
}

/**
 * 生成修复建议
 */
function generateRecommendations(layers: DiagnosticResult["layers"]): string[] {
  const recommendations: string[] = [];

  if (layers.dns.status === "failed") {
    recommendations.push("DNS 解析失败，请检查域名是否正确或网络连接是否正常");
  }

  if (layers.tls.status === "failed") {
    recommendations.push("TLS 握手失败，请检查证书配置或服务器 SSL/TLS 设置");
  } else if (layers.tls.status === "warning") {
    recommendations.push(layers.tls.message || "TLS 证书即将过期");
  }

  if (layers.ttfb.status === "warning") {
    recommendations.push("TTFB 较高，建议优化服务器性能或考虑使用 CDN");
  } else if (layers.ttfb.status === "failed") {
    recommendations.push("无法连接到端点，请检查 URL 是否正确或服务是否在线");
  }

  if (layers.api.status === "failed") {
    const details = layers.api.details as { statusCode?: number } | null;
    if (details?.statusCode === 401 || details?.statusCode === 403) {
      recommendations.push("API 认证失败，请检查 API 密钥是否正确");
    } else if (details?.statusCode === 429) {
      recommendations.push("触发速率限制，建议增加检查间隔或升级配额");
    } else {
      recommendations.push("API 响应异常，请检查端点配置或查看详细错误信息");
    }
  }

  if (layers.validation.status === "failed") {
    recommendations.push("内容验证失败，模型可能不可用或响应格式不正确");
  }

  return recommendations;
}

/**
 * 计算整体状态
 */
function calculateOverallStatus(layers: DiagnosticResult["layers"]): DiagnosticOverallStatus {
  const statuses = Object.values(layers).map((l) => l.status);

  if (statuses.every((s) => s === "success" || s === "skipped")) {
    return "success";
  }

  if (statuses.some((s) => s === "failed")) {
    if (statuses.filter((s) => s === "failed").length >= 3) {
      return "failed";
    }
    return "partial";
  }

  return "partial";
}

/**
 * POST /api/admin/configs/[id]/diagnose
 * 执行配置诊断
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data: configData, error: configError } = await admin
    .from("check_configs")
    .select(
      "id,name,type,model,endpoint,api_key,is_maintenance,request_header,metadata,group_name,stream_mode"
    )
    .eq("id", id)
    .single();

  if (configError || !configData) {
    return NextResponse.json({ error: "配置不存在" }, { status: 404 });
  }

  const config: ProviderConfig = {
    id: configData.id,
    name: configData.name,
    type: configData.type as ProviderType,
    endpoint: configData.endpoint,
    model: configData.model,
    apiKey: configData.api_key,
    is_maintenance: configData.is_maintenance,
    requestHeaders: (configData.request_header as Record<string, string>) || null,
    metadata: (configData.metadata as Record<string, unknown>) || null,
    groupName: configData.group_name || null,
    streamMode: configData.stream_mode || null,
  };

  // SSRF 防护：诊断会携带真实凭据向 config.endpoint 发起 DNS/TLS/HTTP 请求，
  // 先校验端点不指向私有/环回/链路本地网段，防止内网探测与凭据外发
  const safety = await assertEndpointSafe(config.endpoint);
  if (!safety.ok) {
    return NextResponse.json({ error: `端点校验未通过：${safety.reason}` }, { status: 400 });
  }

  const startedAt = new Date();

  try {
    const dnsResult = await diagnoseDNS(config.endpoint);

    let tlsResult: DiagnosticLayer;
    if (dnsResult.status === "failed") {
      tlsResult = {
        name: "TLS 握手",
        status: "skipped",
        startTime: dnsResult.endTime,
        endTime: dnsResult.endTime,
        durationMs: null,
        message: "DNS 解析失败，跳过后续检查",
        details: null,
      };
    } else {
      tlsResult = await diagnoseTLS(config.endpoint, dnsResult.endTime);
    }

    let ttfbResult: DiagnosticLayer;
    if (dnsResult.status === "failed") {
      ttfbResult = {
        name: "TTFB 测量",
        status: "skipped",
        startTime: tlsResult.endTime,
        endTime: tlsResult.endTime,
        durationMs: null,
        message: "DNS 解析失败，跳过后续检查",
        details: null,
      };
    } else {
      ttfbResult = await measureTTFB(config.endpoint, tlsResult.endTime);
    }

    let apiResult: DiagnosticLayer;
    if (dnsResult.status === "failed" || ttfbResult.status === "failed") {
      apiResult = {
        name: "API 响应",
        status: "skipped",
        startTime: ttfbResult.endTime,
        endTime: ttfbResult.endTime,
        durationMs: null,
        message: "前置检查失败，跳过",
        details: null,
      };
    } else {
      apiResult = await validateAPIResponse(config, ttfbResult.endTime);
    }

    let validationResult: DiagnosticLayer;
    if (
      dnsResult.status === "failed" ||
      ttfbResult.status === "failed" ||
      apiResult.status === "failed"
    ) {
      validationResult = {
        name: "内容验证",
        status: "skipped",
        startTime: apiResult.endTime,
        endTime: apiResult.endTime,
        durationMs: null,
        message: "前置检查失败，跳过",
        details: null,
      };
    } else {
      validationResult = await validateContent(config, apiResult.endTime);
    }

    const completedAt = new Date();
    const totalDurationMs = completedAt.getTime() - startedAt.getTime();

    const layers = {
      dns: dnsResult,
      tls: tlsResult,
      ttfb: ttfbResult,
      api: apiResult,
      validation: validationResult,
    };

    const overallStatus = calculateOverallStatus(layers);
    const recommendations = generateRecommendations(layers);

    const result: DiagnosticResult = {
      id: `diag-${Date.now()}-${id.substring(0, 8)}`,
      configId: id,
      configName: config.name,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      totalDurationMs,
      overallStatus,
      layers,
      recommendations,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("诊断执行失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "诊断失败" },
      { status: 500 }
    );
  }
}

