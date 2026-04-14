import type {Metadata} from "next";
import {Geist, Geist_Mono} from "next/font/google";
import "./globals.css";
import "@/lib/core/poller";
import NextTopLoader from "nextjs-toploader";
import {ThemeProvider} from "@/components/theme-provider";
import {NotificationBanner} from "@/components/notification-banner";
import {getSiteSeoConfig, toAbsoluteUrl} from "@/lib/core/site-seo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const {title, description, faviconUrl, logoUrl, keywords, siteUrl} = await getSiteSeoConfig();
  const canonical = toAbsoluteUrl("/", siteUrl);
  const ogImageSource = logoUrl || faviconUrl;
  const ogImage = toAbsoluteUrl(ogImageSource, siteUrl) ?? ogImageSource;

  return {
    metadataBase: siteUrl ? new URL(siteUrl) : undefined,
    title: {
      default: title,
      template: `%s | ${title}`,
    },
    description,
    keywords,
    alternates: {
      canonical: canonical ?? "/",
      types: {
        "application/rss+xml": canonical ? canonical.replace(/\/$/, "") + "/rss.xml" : "/rss.xml",
      },
    },
    openGraph: {
      type: "website",
      url: canonical ?? undefined,
      title,
      description,
      siteName: title,
      images: ogImage ? [{url: ogImage}] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
    icons: {
      icon: faviconUrl,
    },
  };
}

const themeBootScript = `(()=>{
  const root = document.documentElement;
  let inIframe = false;
  try { inIframe = window.self !== window.top; } catch(e) { inIframe = true; }

  const hour = new Date().getHours();
  const isDark = inIframe ? true : (hour >= 19 || hour < 7);

  root.classList.toggle('in-iframe', inIframe);
  root.classList.toggle('dark', isDark);
  root.style.colorScheme = isDark ? 'dark' : 'light';

  // iframe 场景：强制暗色，并锁定 next-themes 的持久化值，避免被用户/系统偏好覆盖
  if (inIframe) {
    try { localStorage.setItem('theme', 'dark'); } catch(e) {}
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          id="theme-boot"
          dangerouslySetInnerHTML={{ __html: themeBootScript }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <NextTopLoader color="var(--foreground)" showSpinner={false} />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NotificationBanner />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
