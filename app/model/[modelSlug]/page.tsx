import {modelMetadata} from "@/lib/core/model-metadata";
import {notFound} from "next/navigation";

import {ModelDetailView} from "@/components/model-detail-view";
import {getModelDetail, resolveMonitoredModelSlug} from "@/lib/core/model-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ModelPageProps {
  params: Promise<{modelSlug: string}>;
}

export async function generateMetadata({params}: ModelPageProps) {
  return modelMetadata((await params).modelSlug, "overview");
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
