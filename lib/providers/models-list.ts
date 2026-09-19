/* ============================================================================
 * 模型列表获取
 *
 * 统一根据「业务端点 + API Key」请求上游的模型列表接口（OpenAI 风格 /models，
 * new-api / one-api 等网关对所有协议类型均暴露该接口），不再按 Provider 写死
 * 模型清单。
 * ==========================================================================*/

export interface ModelInfo {
  id: string;
  name: string;
}

/** 官方 Gemini 域名：使用 x-goog-api-key 鉴权，且列表响应为原生 Gemini 格式 */
const GOOGLE_HOST = "generativelanguage.googleapis.com";

/** 原生 Gemini 业务端点（.../v1beta/models/xxx:generateContent），捕获版本前缀（如 /v1beta） */
const NATIVE_GEMINI_PATH = /^(.*\/v\d+\w*)\/models\/[^/:]+:(generateContent|streamGenerateContent)\/?$/;

/** OpenAI / Anthropic 等业务端点后缀 */
const BUSINESS_SUFFIX_PATH = /\/(chat\/completions|completions|responses|messages)$/i;

/**
 * 由业务端点推导候选的模型列表地址（按优先级排列）：
 * - 原生 Gemini 端点 → 同版本 /models；非官方域名（网关）额外回退 origin/v1/models
 * - 业务端点（chat/completions|responses|messages 结尾）→ 同层级 models
 * - 已是 models → 原样
 * - 其余（baseURL、裸域名）→ 追加 /models；裸域名取 /v1/models（官方 Gemini 取 /v1beta/models）
 */
export function deriveModelListUrls(endpoint: string): string[] {
  const url = new URL(endpoint);
  url.search = "";
  url.hash = "";
  const origin = url.origin;
  const path = url.pathname.replace(/\/+$/, "");

  const nativeMatch = path.match(NATIVE_GEMINI_PATH);
  if (nativeMatch) {
    const versionBase = nativeMatch[1]; // 例如 /v1beta
    const urls = [`${origin}${versionBase}/models`];
    if (url.hostname !== GOOGLE_HOST) urls.push(`${origin}/v1/models`);
    return urls;
  }

  if (BUSINESS_SUFFIX_PATH.test(path)) {
    return [`${origin}${path.replace(BUSINESS_SUFFIX_PATH, "/models")}`];
  }

  if (/\/models$/i.test(path)) {
    return [`${origin}${path}`];
  }

  if (path === "") {
    return [url.hostname === GOOGLE_HOST ? `${origin}/v1beta/models` : `${origin}/v1/models`];
  }

  return [`${origin}${path}/models`];
}

interface FetchModelListOptions {
  type: string;
  endpoint: string;
  apiKey: string;
  timeoutMs?: number;
}

/**
 * 请求上游模型列表。
 * 兼容两种响应格式：
 * - OpenAI 风格：{ data: [{ id }] }
 * - 原生 Gemini：{ models: [{ name: "models/xxx", displayName }] }
 */
export async function fetchModelList(options: FetchModelListOptions): Promise<ModelInfo[]> {
  const urls = deriveModelListUrls(options.endpoint);
  let lastError: Error = new Error("获取模型列表失败");

  for (const url of urls) {
    try {
      return await requestModelList(url, options);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError;
}

async function requestModelList(url: string, options: FetchModelListOptions): Promise<ModelInfo[]> {
  const { type, apiKey, timeoutMs = 10_000 } = options;
  const signal = AbortSignal.timeout(timeoutMs);

  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (new URL(url).hostname === GOOGLE_HOST) {
    headers["x-goog-api-key"] = apiKey;
  }

  let res = await fetch(url, { headers, signal });

  // 官方 Anthropic API 只认 x-api-key，Bearer 401 时换用官方鉴权重试一次
  if ((res.status === 401 || res.status === 403) && type === "anthropic") {
    res = await fetch(url, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal,
    });
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`上游返回 HTTP ${res.status}${formatBodySnippet(text)}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`上游返回非 JSON 响应${formatBodySnippet(text)}`);
  }

  return parseModelPayload(payload, new URL(url).hostname);
}

function parseModelPayload(payload: unknown, hostname: string): ModelInfo[] {
  const raw = Array.isArray((payload as { data?: unknown[] })?.data)
    ? (payload as { data: unknown[] }).data
    : Array.isArray((payload as { models?: unknown[] })?.models)
      ? (payload as { models: unknown[] }).models
      : [];

  const models: ModelInfo[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { id?: unknown; name?: unknown; displayName?: unknown };

    // 原生 Gemini 条目：name 形如 models/gemini-2.5-flash
    let id = typeof record.id === "string" ? record.id : "";
    let name = id;
    if (!id && typeof record.name === "string") {
      id = record.name.replace(/^models\//, "");
      name = typeof record.displayName === "string" ? record.displayName : id;
    }
    if (!id) continue;

    // 官方 Gemini 列表含 embedding/tts 等非对话模型，仅保留 gemini 系列
    if (hostname === GOOGLE_HOST && !id.includes("gemini")) continue;

    models.push({ id, name: name || id });
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function formatBodySnippet(text: string): string {
  const snippet = text.trim().slice(0, 200);
  return snippet ? `：${snippet}` : "";
}
