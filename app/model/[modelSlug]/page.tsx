import type {Metadata} from "next";
import {notFound} from "next/navigation";

import {ModelDetailView} from "@/components/model-detail-view";
import {getModelDetail, resolveMonitoredModelSlug} from "@/lib/core/model-data";
import {getSiteSeoConfig, toAbsoluteUrl} from "@/lib/core/site-seo";
import {getModelPath} from "@/lib/utils/model-slug";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ModelPageProps {
  params: Promise<{modelSlug: string}>;
}

export async function generateMetadata(
  {params}: ModelPageProps
): Promise<Metadata> {
  const {modelSlug} = await params;
  const modelName = await resolveMonitoredModelSlug(modelSlug);
  if (!modelName) {
    return {title: "模型未找到"};
  }

  const [detail, siteSeo] = await Promise.all([
    getModelDetail(modelName),
    getSiteSeoConfig(),
  ]);
  if (!detail) {
    return {title: "模型未找到"};
  }

  const description = detail.pricing?.description
    ?? `查看 ${detail.modelName} 的 API 健康状态、延迟和可用率。`;
  const canonical = toAbsoluteUrl(getModelPath(detail.modelName), siteSeo.siteUrl);

  return {
    title: detail.modelName,
    description,
    keywords: [...siteSeo.keywords, detail.modelName],
    alternates: {
      canonical: canonical ?? getModelPath(detail.modelName),
    },
    openGraph: {
      type: "website",
      url: canonical ?? undefined,
      title: `${detail.modelName} | ${siteSeo.title}`,
      description,
      siteName: siteSeo.title,
    },
    twitter: {
      card: "summary",
      title: `${detail.modelName} | ${siteSeo.title}`,
      description,
    },
  };
}

export default async function ModelPage({params}: ModelPageProps) {
  const {modelSlug} = await params;
  const modelName = await resolveMonitoredModelSlug(modelSlug);
  if (!modelName) {
    notFound();
  }

  const detail = await getModelDetail(modelName);
  if (!detail) {
    notFound();
  }

  return <ModelDetailView detail={detail} activeTab="overview" />;
}
