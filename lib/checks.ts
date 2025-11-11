import "server-only";

export type ProviderType = "openai" | "gemini" | "anthropic";

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  endpoint: string;
  model: string;
  apiKey: string;
}

export type HealthStatus = "operational" | "degraded" | "failed";

export interface CheckResult {
  id: string;
  name: string;
  type: ProviderType;
  endpoint: string;
  model: string;
  status: HealthStatus;
  latencyMs: number | null;
  checkedAt: string;
  message: string;
}

const DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "https://api.anthropic.com/v1/messages",
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEGRADED_THRESHOLD_MS = 6_000;

export function loadProviderConfigs(): ProviderConfig[] {
  const groupList = (process.env.CHECK_GROUPS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const configs: ProviderConfig[] = [];

  for (const groupId of groupList) {
    const upperId = groupId.toUpperCase();
    const read = (suffix: string) => process.env[`CHECK_${upperId}_${suffix}`]?.trim();

    const type = normalizeType(read("TYPE"));
    const apiKey = read("KEY");
    const model = read("MODEL");
    const endpoint = read("ENDPOINT") || DEFAULT_ENDPOINTS[type ?? "openai"];
    const name = read("NAME") || groupId;

    if (!type || !apiKey || !model) {
      console.warn(
        `[check-cx] 跳过配置 ${groupId}：缺少TYPE/KEY/MODEL，其中 type=${type}, key=${maskKey(
          apiKey
        )}, model=${model}`
      );
      continue;
    }

    configs.push({
      id: groupId,
      name,
      type,
      endpoint,
      model,
      apiKey,
    });
  }

  return configs;
}

export async function runProviderChecks(): Promise<CheckResult[]> {
  const configs = loadProviderConfigs();
  if (configs.length === 0) {
    return [];
  }

  const results = await Promise.all(
    configs.map(async (config) => {
      try {
        return await checkProvider(config);
      } catch (error) {
        const err = error as Error;
        return {
          id: config.id,
          name: config.name,
          type: config.type,
          endpoint: config.endpoint,
          model: config.model,
          status: "failed" as const,
          latencyMs: null,
          checkedAt: new Date().toISOString(),
          message: err?.message || "未知错误",
        };
      }
    })
  );

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

async function checkProvider(config: ProviderConfig): Promise<CheckResult> {
  switch (config.type) {
    case "openai":
      return checkOpenAI(config);
    case "gemini":
      return checkGemini(config);
    case "anthropic":
      return checkAnthropic(config);
    default:
      throw new Error(`Unsupported provider: ${config.type}`);
  }
}

async function checkOpenAI(config: ProviderConfig): Promise<CheckResult> {
  const url = ensurePath(config.endpoint, "/v1/chat/completions");
  const payload = {
    model: config.model,
    messages: [
      { role: "system", content: "You are a health check endpoint." },
      { role: "user", content: "ping" },
    ],
    max_tokens: 3,
    temperature: 0,
  };

  return runHttpCheck(config, {
    url,
    displayEndpoint: config.endpoint,
    init: {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  });
}

async function checkGemini(config: ProviderConfig): Promise<CheckResult> {
  const normalized = config.endpoint.endsWith(":generateContent")
    ? config.endpoint
    : `${config.endpoint.replace(/\/$/, "")}/models/${config.model}:generateContent`;

  const url = appendQuery(normalized, `key=${config.apiKey}`);
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: "ping" }],
      },
    ],
  };

  return runHttpCheck(config, {
    url,
    displayEndpoint: config.endpoint,
    init: {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  });
}

async function checkAnthropic(config: ProviderConfig): Promise<CheckResult> {
  const url = ensurePath(config.endpoint, "/v1/messages");
  const payload = {
    model: config.model,
    max_tokens: 10,
    messages: [{ role: "user", content: "ping" }],
  };

  return runHttpCheck(config, {
    url,
    displayEndpoint: config.endpoint,
    init: {
      headers: {
        "x-api-key": config.apiKey,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    },
  });
}

async function runHttpCheck(
  config: ProviderConfig,
  params: {
    url: string;
    displayEndpoint?: string;
    init: RequestInit;
  }
): Promise<CheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(params.url, {
      method: "POST",
      signal: controller.signal,
      ...params.init,
    });
    const latencyMs = Date.now() - startedAt;
    const body = await readBody(response);

    const status: HealthStatus =
      response.ok && latencyMs <= DEGRADED_THRESHOLD_MS
        ? "operational"
        : response.ok
        ? "degraded"
        : "failed";

    const message = response.ok
      ? status === "degraded"
        ? `响应成功但耗时 ${latencyMs}ms`
        : `响应正常 (HTTP ${response.status})`
      : extractMessage(body) || `HTTP ${response.status}`;

    return {
      id: config.id,
      name: config.name,
      type: config.type,
      endpoint: params.displayEndpoint || params.url,
      model: config.model,
      status,
      latencyMs,
      checkedAt: new Date().toISOString(),
      message,
    };
  } catch (error) {
    const err = error as Error & { name?: string };
    const message = err?.name === "AbortError" ? "请求超时" : err?.message || "未知错误";
    return {
      id: config.id,
      name: config.name,
      type: config.type,
      endpoint: params.displayEndpoint || params.url,
      model: config.model,
      status: "failed",
      latencyMs: null,
      checkedAt: new Date().toISOString(),
      message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeType(value?: string | null): ProviderType | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === "openai") return "openai";
  if (lower === "gemini") return "gemini";
  if (lower === "anthropic") return "anthropic";
  return undefined;
}

function ensurePath(endpoint: string, fallbackPath: string) {
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

function appendQuery(url: string, query: string) {
  return url.includes("?") ? `${url}&${query}` : `${url}?${query}`;
}

async function readBody(response: Response) {
  const text = await response.text();
  return text;
}

function extractMessage(body: string) {
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

function maskKey(key?: string | null) {
  if (!key) return "";
  if (key.length <= 4) return "****";
  return `${key.slice(0, 4)}****${key.slice(-2)}`;
}
