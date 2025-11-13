import { NextResponse } from "next/server";

import { loadDashboardData } from "@/lib/core/dashboard-data";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await loadDashboardData({ refreshMode: "always" });
  return NextResponse.json(data);
}
