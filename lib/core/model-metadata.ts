import "server-only";
import {resolvePublicScope} from "./public-scope";
import {publicMetadata} from "./public-metadata";
import {getModelPricingMetadata} from "./model-pricing";

export async function modelMetadata(slug: string, tab: "overview" | "performance" | "api") {
  const resolved = await resolvePublicScope({scope: "model", value: slug});
  if (!resolved) return {title: "模型未找到", robots: {index: false, follow: false}};
  const pricing = await getModelPricingMetadata(resolved.key);
  const label = {overview: "状态概览", performance: "性能监控", api: "API 接入"}[tab];
  return publicMetadata({title: `${resolved.title} ${label}`, description: pricing?.description?.trim() || `查看 ${resolved.title} 的已配置渠道、健康状态与近 24 小时、7 天、15 天、30 天的探测统计。`,
    path: `${resolved.path}${tab === "overview" ? "" : `/${tab}`}`, scope: resolved.scope});
}
