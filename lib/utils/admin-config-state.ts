/**
 * 前台管理控件共享的配置状态加载
 * 模块级缓存保证同页所有卡片共享一次 fetch，避免重复请求。
 */

export interface AdminConfigState {
  enabled: boolean;
  is_maintenance: boolean;
}

let cachedConfigState: Record<string, AdminConfigState> | null = null;
let configStateFetching: Promise<Record<string, AdminConfigState>> | null = null;

export function loadConfigState(): Promise<Record<string, AdminConfigState>> {
  if (cachedConfigState) return Promise.resolve(cachedConfigState);
  if (!configStateFetching) {
    configStateFetching = fetch("/api/admin/configs", {cache: "no-store"})
      .then((res) => (res.ok ? res.json() : []))
      .then((list: { id: string; enabled: boolean; is_maintenance: boolean }[]) => {
        const map: Record<string, AdminConfigState> = {};
        for (const c of list) {
          map[c.id] = { enabled: c.enabled, is_maintenance: c.is_maintenance };
        }
        cachedConfigState = map;
        configStateFetching = null;
        return map;
      })
      .catch((err) => {
        configStateFetching = null;
        throw err;
      });
  }
  return configStateFetching;
}
