import type {Metadata} from "next";
import {notFound} from "next/navigation";

import {ModelDetailView} from "@/components/model-detail-view";
import {getModelDetail, resolveMonitoredModelSlug} from "@/lib/core/model-data";
import {getSiteSeoConfig, toAbsoluteUrl} from "@/lib/core/site-seo";
import {getModelPath} from "@/lib/utils/model-slug";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ApiPageProps {
  params: Promise<{modelSlug: string}>;
}

export async function generateMetadata({params}: ApiPageProps): Promise<Metadata> {
  const modelName = await resolveMonitoredModelSlug((await params).modelSlug);
  const siteSeo = await getSiteSeoConfig();
  if (!modelName) return {title: "模型未找到"};
  const title = `${modelName} API`;
  return {
    title,
    description: `查看 ${modelName} 支持的 API 端点、分组和定价元数据。`,
    alternates: {canonical: toAbsoluteUrl(`${getModelPath(modelName)}/api`, siteSeo.siteUrl) ?? `${getModelPath(modelName)}/api`},
  };
}

export default async function ApiPage({params}: ApiPageProps) {
  const modelName = await resolveMonitoredModelSlug((await params).modelSlug);
  if (!modelName) notFound();
  const detail = await getModelDetail(modelName);
  if (!detail) notFound();
  return <ModelDetailView detail={detail} activeTab="api" />;
}
