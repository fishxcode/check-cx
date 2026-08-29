import "server-only";
import * as dns from "dns/promises";

/**
 * SSRF 防护：校验目标主机解析出的 IP 是否落在受限网段。
 * 用于诊断等会向配置端点发起服务端请求的场景，防止内网探测与元数据地址访问。
 */

/** 将点分/冒号 IP 归一化判断是否属于私有、环回、链路本地或保留网段 */
function isBlockedIp(ip: string): boolean {
  // IPv4
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true;                       // 10.0.0.0/8
    if (a === 127) return true;                      // 127.0.0.0/8 环回
    if (a === 0) return true;                        // 0.0.0.0/8
    if (a === 169 && b === 254) return true;         // 169.254.0.0/16 链路本地（含云元数据 169.254.169.254）
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;         // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true;                       // 组播/保留
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;              // 环回/未指定
  if (lower.startsWith("fe80")) return true;                       // 链路本地
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // 唯一本地地址 fc00::/7
  if (lower.startsWith("::ffff:")) {                               // IPv4 映射地址
    return isBlockedIp(lower.slice(7));
  }
  return false;
}

export interface SsrfCheckResult {
  ok: boolean;
  reason?: string;
  addresses?: string[];
}

/**
 * 校验端点是否可安全地由服务端发起请求。
 * - 仅允许 http/https 协议
 * - 解析主机名的所有 A/AAAA 记录，任一落在受限网段即拒绝（防 DNS rebinding 的首道防线）
 * - 字面量私有 IP 直接拒绝
 */
export async function assertEndpointSafe(endpoint: string): Promise<SsrfCheckResult> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: "无效的 URL 格式" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `不支持的协议：${url.protocol}` };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  // 字面量 IP：直接判定
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) {
    if (isBlockedIp(hostname)) return { ok: false, reason: "目标指向受限网段（私有/环回/链路本地）" };
    return { ok: true, addresses: [hostname] };
  }

  // 域名：解析全部 IP，任一受限即拒绝
  let addresses: string[];
  try {
    const [v4, v6] = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
    addresses = [
      ...(v4.status === "fulfilled" ? v4.value : []),
      ...(v6.status === "fulfilled" ? v6.value : []),
    ];
  } catch {
    return { ok: false, reason: "DNS 解析失败" };
  }

  if (addresses.length === 0) return { ok: false, reason: "DNS 未解析到任何地址" };

  const blocked = addresses.find(isBlockedIp);
  if (blocked) return { ok: false, reason: `目标解析到受限地址 ${blocked}` };

  return { ok: true, addresses };
}
