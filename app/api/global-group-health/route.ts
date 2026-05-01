import {NextResponse} from "next/server";

import {loadGlobalGroupHealth} from "@/lib/core/global-group-health";
import type {GlobalGroupHealthWindow} from "@/lib/types";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const VALID_WINDOWS: GlobalGroupHealthWindow[] = ["1h", "6h", "12h", "24h", "7d", "15d", "30d"];

export async function GET(request: Request) {
  const {searchParams} = new URL(request.url);
  const windowParam = searchParams.get("window");
  const forceRefreshParam = searchParams.get("forceRefresh");
  const window = VALID_WINDOWS.includes(windowParam as GlobalGroupHealthWindow)
    ? (windowParam as GlobalGroupHealthWindow)
    : "24h";

  const summary = await loadGlobalGroupHealth({
    forceRefresh: forceRefreshParam === "1" || forceRefreshParam === "true",
    windows: [window],
  });

  return NextResponse.json(summary, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
