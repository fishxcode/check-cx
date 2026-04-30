import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { ClientYear } from "@/components/client-time";
import { GlobalGroupHealthPanel } from "@/components/global-group-health-panel";
import { loadGlobalGroupHealth } from "@/lib/core/global-group-health";
import { getSiteSeoConfig, toAbsoluteUrl } from "@/lib/core/site-seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const siteSeo = await getSiteSeoConfig();
  const canonical = toAbsoluteUrl("/group/global", siteSeo.siteUrl);
  const title = "全局分组监控";
  const description = "查看 fishxcode 全局分组健康状态、请求量、错误量和主要错误原因。";

  return {
    title,
    description,
    keywords: [...siteSeo.keywords, "全局分组监控", "fishxcode"],
    alternates: {
      canonical: canonical ?? "/group/global",
    },
    openGraph: {
      type: "website",
      url: canonical ?? undefined,
      title: `${title} | ${siteSeo.title}`,
      description,
      siteName: siteSeo.title,
    },
    twitter: {
      card: "summary",
      title: `${title} | ${siteSeo.title}`,
      description,
    },
  };
}

export default async function GlobalGroupPage() {
  const [siteSeo, globalGroupHealth] = await Promise.all([
    getSiteSeoConfig(),
    loadGlobalGroupHealth(),
  ]);

  return (
    <div className="min-h-screen py-6 md:py-10">
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-3 sm:gap-6 sm:px-6 lg:px-12">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border/40 bg-background/60 px-4 py-1.5 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition hover:border-border/80 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          返回首页
        </Link>

        <header className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Global Group
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            全局分组监控
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
            按 1 小时、6 小时、12 小时、24 小时查看 fishxcode 全局分组健康状态。
          </p>
        </header>

        <GlobalGroupHealthPanel
          summary={globalGroupHealth}
          className="mb-0"
          showDetailLink={false}
        />
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
