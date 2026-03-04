import { createAdminClient } from "@/lib/supabase/admin";

let _cache: Record<string, string> = {};
let _cacheAt = 0;
let _refreshing = false;
const TTL_MS = 30_000;

export function getSiteSettingSync(key: string, fallback: string): string {
  return _cache[key] ?? fallback;
}

export async function refreshSiteSettings(): Promise<void> {
  if (_refreshing || Date.now() - _cacheAt < TTL_MS) return;
  _refreshing = true;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("site_settings").select("key, value");
    const map: Record<string, string> = {};
    for (const row of data ?? []) {
      if (row.value != null) map[row.key] = row.value;
    }
    _cache = map;
    _cacheAt = Date.now();
  } catch {
    // 静默失败，保留旧缓存
  } finally {
    _refreshing = false;
  }
}

/**
 * 获取所有站点配置（用于 API 端点）
 */
export async function getAllSiteSettings(): Promise<Record<string, string>> {
  await refreshSiteSettings();
  return _cache;
}
