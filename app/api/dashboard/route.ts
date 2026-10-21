import {NextResponse} from "next/server";

import {loadDashboardDataWithEtag} from "@/lib/core/dashboard-data";
import {withPublicResponseCache} from "@/lib/core/public-response-cache";
import type {AvailabilityPeriod} from "@/lib/types";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const VALID_PERIODS: AvailabilityPeriod[] = ["24h", "7d", "15d", "30d"];

export async function GET(request: Request) {
  const period = new URL(request.url).searchParams.get("trendPeriod");
  const trendPeriod = VALID_PERIODS.includes(period as AvailabilityPeriod)
    ? (period as AvailabilityPeriod)
    : "7d";

  return withPublicResponseCache(request, `dashboard:${trendPeriod}`, async () => {
    const {data, etag} = await loadDashboardDataWithEtag({refreshMode: "never", trendPeriod});
    return NextResponse.json(data, {headers: {ETag: etag}});
  });
}
