/**
 * 统一的缓存失效入口
 *
 * 前台展示链路依赖多层内存缓存（ping 去重、看板、分组看板、可用性统计、配置列表），
 * 任何影响前台展示的写操作（配置增删改、分组信息、首页排序）都必须整体失效，
 * 只清其中一层会导致前台继续展示旧数据直到各自 TTL（轮询间隔）自然过期。
 */
import {clearAvailabilityStatsCache} from "@/lib/database/availability";
import {clearConfigCache} from "@/lib/database/config-loader";

import {clearDashboardDataCache} from "./dashboard-data";
import {clearGroupDashboardCache} from "./group-data";
import {clearPingCache} from "./global-state";

export function clearAllCaches(): void {
  clearPingCache();
  clearDashboardDataCache();
  clearGroupDashboardCache();
  clearAvailabilityStatsCache();
  clearConfigCache();
}
