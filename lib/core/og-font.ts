import "server-only";
const cache = new Map<string, Promise<ArrayBuffer>>();
/** 只将已公开的标题发送至固定字体服务，缓存容量有界。 */
export function loadOgFont(text: string) {
  const subset = [...new Set(text)].sort().join("");
  if (cache.has(subset)) return cache.get(subset)!;
  const request = (async () => {
    const url = new URL("https://fonts.googleapis.com/css2");
    url.searchParams.set("family", "Noto Sans SC:wght@600"); url.searchParams.set("text", subset);
    const css = await fetch(url, {signal: AbortSignal.timeout(5000), headers: {"User-Agent": "CheckCX-OG"}});
    if (!css.ok) throw new Error("字体服务不可用");
    const source = (await css.text()).match(/src:\s*url\(([^)]+)\)/)?.[1];
    const fontUrl = new URL(source ?? "invalid:");
    if (fontUrl.protocol !== "https:" || fontUrl.hostname !== "fonts.gstatic.com") throw new Error("字体来源无效");
    const font = await fetch(fontUrl, {signal: AbortSignal.timeout(5000)});
    if (!font.ok) throw new Error("字体服务不可用");
    return font.arrayBuffer();
  })();
  if (cache.size >= 24) cache.delete(cache.keys().next().value!);
  cache.set(subset, request);
  void request.catch(() => cache.delete(subset));
  return request;
}
