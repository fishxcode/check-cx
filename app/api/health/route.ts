import {NextResponse} from "next/server";

export const dynamic = "force-dynamic";

/** 轻量存活探针，供 Docker healthcheck 或负载均衡使用，不触发数据库查询。 */
export async function GET() {
  return NextResponse.json({ok: true}, {headers: {"Cache-Control": "no-store"}});
}
