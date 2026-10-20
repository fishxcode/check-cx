import type {Metadata} from "next";
import {notFound} from "next/navigation";

import {ModelDetailView} from "@/components/model-detail-view";
import {getModelDetail, resolveMonitoredModelSlug} from "@/lib/core/model-data";
import {getSiteSeoConfig, toAbsoluteUrl} from "@/lib/core/site-seo";
import {getModelPath} from "@/lib/utils/model-slug";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PerformancePageProps {
  params: Promise<{modelSlug: string}>;
}

export async function generateMetadata({params}: PerformancePageProps): Promise<Metadata> {
  const modelName = await resolveMonitoredModelSlug((await params).modelSlug);
  const siteSeo = await getSiteSeoConfig();
  if (!modelName) return {title: "模型未找到"};
  const title = `${modelName} 性能`;
  return {
    title,
    description: `查看 ${modelName} 的检测延迟、可用率和历史性能。`,
    alternates: {canonical: toAbsoluteUrl(`${getModelPath(modelName)}/performance`, siteSeo.siteUrl) ?? `${getModelPath(modelName)}/performance`},
  };
}

export default async function PerformancePage({params}: PerformancePageProps) {
  const modelName = await resolveMonitoredModelSlug((await params).modelSlug);
  if (!modelName) notFound();
  const detail = await getModelDetail(modelName);
  if (!detail) notFound();
  return <ModelDetailView detail={detail} activeTab="performance" />;
}
