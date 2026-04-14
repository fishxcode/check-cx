import {DashboardBootstrap} from "@/components/dashboard-bootstrap";
import {ClientYear} from "@/components/client-time";
import {getSiteSettingSync, refreshSiteSettings} from "@/lib/core/site-settings";
import Link from "next/link";
import packageJson from "@/package.json";

const ESTIMATED_VERSION = `v${packageJson.version}`;
const DEFAULT_SITE_TITLE = "Check CX";

export default async function Home() {
  await refreshSiteSettings();
  const siteTitle = getSiteSettingSync("site.title", DEFAULT_SITE_TITLE);

  return (
    <div className="py-6 md:py-10">
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-3 sm:gap-6 sm:px-6 lg:px-12">
        <DashboardBootstrap />
      </main>
      
      <footer className="mt-12 border-t border-border/40">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col items-center justify-between gap-3 px-3 py-5 sm:flex-row sm:px-6 lg:px-12">
          <div className="text-sm text-muted-foreground">
            © <ClientYear placeholder="2026" /> {siteTitle}. All rights reserved.
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-end">
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
            <div className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/60 px-3 py-1 text-xs text-muted-foreground shadow-sm transition hover:border-border/80 hover:text-foreground">
              <span className="font-medium opacity-70">Ver.</span>
              <span className="font-mono">{ESTIMATED_VERSION}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
