import "server-only";
import {getAllSiteSettings} from "./site-settings";
import {getMonitoringStatistics} from "@/lib/database/monitoring-statistics";

/** 展示策略独立于统计缓存，公开统计接口不经过此层。 */
export async function getDisplayMonitoringStatistics() {
  const [snapshot, settings] = await Promise.all([getMonitoringStatistics(), getAllSiteSettings()]);
  return {...snapshot, showSla: settings.show_sla !== "false"};
}
