import "server-only";

const pendingResponses = new Map<string, Promise<Response>>();

function edgeCache(): Cache | undefined {
  try {
    return (globalThis as typeof globalThis & {caches?: {default?: Cache}}).caches?.default;
  } catch {
    return undefined;
  }
}

function clientResponse(response: Response, request: Request, result: string): Response {
  const headers = new Headers(response.headers);
  // 浏览器始终验证；边缘缓存的有效期单独控制，避免叠加浏览器缓存延迟。
  headers.set("Cache-Control", "public, no-cache");
  headers.set("X-Public-Cache", result);
  const etag = headers.get("ETag");
  const matches = request.headers.get("If-None-Match")?.split(",").some((value) => {
    const candidate = value.trim();
    return candidate === "*" || (etag && candidate.replace(/^W\//, "") === etag.replace(/^W\//, ""));
  });
  if (response.status === 200 && matches) {
    headers.delete("Content-Length");
    return new Response(null, {status: 304, headers});
  }
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

/** 仅用于明确公开的 GET 数据；调用方必须用已验证的维度构造键。 */
export async function withPublicResponseCache(
  request: Request,
  canonicalKey: string,
  loader: () => Promise<Response>,
  ttlSeconds = 30,
): Promise<Response> {
  const key = new Request(new URL(`/__public-response-cache/v1/${encodeURIComponent(canonicalKey)}`, request.url));
  const cache = edgeCache();
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return clientResponse(hit, request, "HIT");
    } catch {
      // 缓存不可用时仍提供原始数据。
    }
  }

  let pending = pendingResponses.get(key.url);
  if (!pending) {
    pending = (async () => {
      const response = await loader();
      const cacheControl = response.headers.get("Cache-Control") ?? "";
      if (cache && response.status === 200 && !response.headers.has("Set-Cookie") &&
          !/\b(private|no-store)\b/i.test(cacheControl) && !response.headers.has("Vary")) {
        try {
          const copy = response.clone();
          const headers = new Headers(copy.headers);
          headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
          await cache.put(key, new Response(copy.body, {status: 200, headers}));
        } catch {
          // 写缓存失败不能使公开接口失败。
        }
      }
      return response;
    })().finally(() => pendingResponses.delete(key.url));
    pendingResponses.set(key.url, pending);
  }
  return clientResponse((await pending).clone(), request, cache ? "MISS" : "BYPASS");
}
