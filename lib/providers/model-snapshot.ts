import "server-only";
import {deriveModelListUrls} from "./models-list";

export interface ModelSnapshotSource {
  type: string;
  endpoint: string;
  api_key: string;
  request_header?: Record<string, string> | null;
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** 自动停用只接受完整、非空的目录，不复用模型选择器的宽松解析。 */
export async function fetchCompleteModelSnapshot(source: ModelSnapshotSource): Promise<Set<string>> {
  const url = new URL(deriveModelListUrls(source.endpoint)[0]);
  const headers = new Headers(source.request_header ?? {});
  if (!headers.has("Authorization") && !headers.has("x-api-key")) headers.set("Authorization", `Bearer ${source.api_key}`);
  if (url.hostname === "generativelanguage.googleapis.com") {
    headers.delete("Authorization");
    headers.set("x-goog-api-key", source.api_key);
  }
  if (url.hostname === "api.anthropic.com") {
    headers.delete("Authorization");
    headers.set("x-api-key", source.api_key);
    if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  }
  const response = await fetch(url, {headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000)});
  if (!response.ok) throw new Error("模型目录请求失败");
  const body: unknown = await response.json();
  if (!record(body)) throw new Error("模型目录格式无效");
  const items = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : null;
  if (!items?.length) throw new Error("空目录不执行同步停用");
  for (const container of [body, body.pagination, body.meta, body.links]) {
    if (!record(container)) continue;
    if (["has_more", "hasMore", "nextPageToken", "next_page_token", "next_cursor", "next"].some((key) => Boolean(container[key]))
      || ["total", "total_count"].some((key) => typeof container[key] === "number" && container[key] > items.length)
      || (typeof container.total_pages === "number" && container.total_pages > 1)) throw new Error("分页目录尚未完整读取");
  }
  if (/\brel\s*=\s*"?next/i.test(response.headers.get("link") ?? "") || Number(response.headers.get("x-total-count")) > items.length) throw new Error("分页目录尚未完整读取");
  const models = new Set<string>();
  for (const item of items) {
    if (!record(item)) throw new Error("目录条目无效");
    const id = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name.replace(/^models\//, "") : "";
    if (!id.trim()) throw new Error("目录缺少模型标识");
    models.add(id);
  }
  return models;
}
