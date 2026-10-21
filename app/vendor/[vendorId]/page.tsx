import {publicMetadata} from "@/lib/core/public-metadata";
import {resolvePublicScope} from "@/lib/core/public-scope";
import Link from "next/link";
import {notFound} from "next/navigation";

import {DashboardBootstrap} from "@/components/dashboard-bootstrap";

export default async function VendorPage({params}: {
  params: Promise<{vendorId: string}>;
}) {
  const {vendorId} = await params;
  if (!vendorId.trim() || !await resolvePublicScope({scope: "vendor", value: vendorId})) notFound();

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 px-4 py-8">
      <Link href="/" className="inline-flex text-sm text-muted-foreground hover:text-foreground">
        返回全部厂家
      </Link>
      <DashboardBootstrap vendorId={vendorId} />
    </main>
  );
}

export async function generateMetadata({params}: {params: Promise<{vendorId: string}>}) {
  const resolved = await resolvePublicScope({scope: "vendor", value: (await params).vendorId});
  if (!resolved) return {title: "厂家未找到", robots: {index: false}};
  return publicMetadata({title: resolved.title, description: `查看 ${resolved.title} 已配置模型、渠道与各时间窗口的探测统计。`, path: resolved.path, scope: resolved.scope});
}
