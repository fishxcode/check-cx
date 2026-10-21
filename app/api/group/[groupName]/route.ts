import {NextResponse} from "next/server";
import {loadGroupDashboardData} from "@/lib/core/group-data";
import {withPublicResponseCache} from "@/lib/core/public-response-cache";
import type {AvailabilityPeriod} from "@/lib/types";

interface RouteContext {
  params: Promise<{ groupName: string }>;
}

export const revalidate = 0;
export const dynamic = "force-dynamic";

/**
 * 生成简单的哈希作为 ETag
 * 使用 djb2 算法，足够快且碰撞率低
 */
function generateETag(data: string): string {
  let hash = 5381;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) + hash) ^ data.charCodeAt(i);
  }
  // 转为无符号 32 位整数的十六进制
  return `"${(hash >>> 0).toString(16)}"`;
}

export async function GET(_request: Request, context: RouteContext) {
  const { groupName } = await context.params;
  const decodedGroupName = decodeURIComponent(groupName);

  const { searchParams } = new URL(_request.url);
  const period = searchParams.get("trendPeriod");
  const trendPeriod = (["24h", "7d", "15d", "30d"] as AvailabilityPeriod[]).includes(
    period as AvailabilityPeriod
  )
    ? (period as AvailabilityPeriod)
    : "7d";

  return withPublicResponseCache(_request, `group:${JSON.stringify([decodedGroupName, trendPeriod])}`, async () => {
    const data = await loadGroupDashboardData(decodedGroupName, {
      refreshMode: "never",
      trendPeriod,
    });
    if (!data) {
      return NextResponse.json({error: "分组不存在或没有配置"}, {status: 404});
    }
    const {generatedAt, ...etagPayload} = data;
    void generatedAt;
    return NextResponse.json(data, {headers: {ETag: generateETag(JSON.stringify(etagPayload))}});
  });
}
