import {notFound} from "next/navigation";
import Link from "next/link";
import {ChevronLeft} from "lucide-react";

import {GroupDashboardBootstrap} from "@/components/group-dashboard-bootstrap";
import {getAvailableGroups} from "@/lib/core/group-data";
import {loadGroupInfos} from "@/lib/database/group-info";
import {getSiteSeoConfig, toAbsoluteUrl} from "@/lib/core/site-seo";
import {ClientYear} from "@/components/client-time";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface GroupPageProps {
  params: Promise<{ groupName: string }>;
}

// 生成页面元数据
export async function generateMetadata({ params }: GroupPageProps) {
  const { groupName } = await params;
  const decodedGroupName = decodeURIComponent(groupName);

  const siteSeo = await getSiteSeoConfig();
  const appTitle = siteSeo.title;

  // 获取分组信息
  const groupInfos = await loadGroupInfos();
  const groupInfo = groupInfos.find((g) => g.group_name === decodedGroupName);
  const groupDisplayName = groupInfo?.display_name || decodedGroupName;
  const groupDescription = groupInfo?.description || `查看 ${decodedGroupName} 分组下的模型健康状态`;
  const canonical = toAbsoluteUrl(`/group/${encodeURIComponent(decodedGroupName)}`, siteSeo.siteUrl);

  return {
    title: groupDisplayName,
    description: groupDescription,
    keywords: [...siteSeo.keywords, groupDisplayName, decodedGroupName],
    alternates: {
      canonical: canonical ?? `/group/${encodeURIComponent(decodedGroupName)}`,
    },
    openGraph: {
      type: "website",
      url: canonical ?? undefined,
      title: `${groupDisplayName} | ${appTitle}`,
      description: groupDescription,
      siteName: appTitle,
    },
    twitter: {
      card: "summary",
      title: `${groupDisplayName} | ${appTitle}`,
      description: groupDescription,
    },
  };
}

export default async function GroupPage({ params }: GroupPageProps) {
  const { groupName } = await params;
  const decodedGroupName = decodeURIComponent(groupName);
  const siteSeo = await getSiteSeoConfig();

  const availableGroups = await getAvailableGroups();
  if (!availableGroups.includes(decodedGroupName)) {
    notFound();
  }

  return (
    <div className="min-h-screen py-6 md:py-10">
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-3 sm:gap-6 sm:px-6 lg:px-12">
        {/* 返回首页链接 */}
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border/40 bg-background/60 px-4 py-1.5 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition hover:border-border/80 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          返回首页
        </Link>

        <GroupDashboardBootstrap groupName={decodedGroupName} />
      </main>

      <footer className="mt-12 border-t border-border/40">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col items-center justify-between gap-3 px-3 py-5 sm:flex-row sm:px-6 lg:px-12">
          <div className="text-sm text-muted-foreground">
            © <ClientYear placeholder="2026" /> {siteSeo.title}. All rights reserved.
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Link href="/rss.xml" className="transition hover:text-foreground">
              RSS
            </Link>
            <Link href="/sitemap.xml" className="transition hover:text-foreground">
              Sitemap
            </Link>
            <Link href="/robots.txt" className="transition hover:text-foreground">
              Robots
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
