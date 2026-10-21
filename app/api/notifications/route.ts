import {withPublicResponseCache} from "@/lib/core/public-response-cache";
import { NextResponse } from "next/server";

import { getActiveSystemNotifications } from "@/lib/database/notifications";

export const revalidate = 0;
export const dynamic = "force-dynamic";

async function loadPublicResponse() {
  const notifications = await getActiveSystemNotifications();

  return NextResponse.json(notifications, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}

export async function GET(request: Request) {
  return withPublicResponseCache(request, "notifications", loadPublicResponse, 30);
}
