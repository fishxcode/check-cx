import {modelMetadata} from "@/lib/core/model-metadata";
import {notFound} from "next/navigation";

import {ModelDetailView} from "@/components/model-detail-view";
import {getModelDetail, resolveMonitoredModelSlug} from "@/lib/core/model-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ApiPageProps {
  params: Promise<{modelSlug: string}>;
}

export async function generateMetadata({params}: ApiPageProps) {
  return modelMetadata((await params).modelSlug, "api");
}

export default async function ApiPage({params}: ApiPageProps) {
  const modelName = await resolveMonitoredModelSlug((await params).modelSlug);
  if (!modelName) notFound();
  const detail = await getModelDetail(modelName);
  if (!detail) notFound();
  return <ModelDetailView detail={detail} activeTab="api" />;
}
