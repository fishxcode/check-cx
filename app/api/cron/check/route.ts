import {NextResponse} from "next/server";

import {runCheckQueuePump} from "@/lib/core/check-queue-pump";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 55;

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
  const headerToken = request.headers.get("x-cron-secret")?.trim();
  return Boolean(cronSecret && (bearerToken === cronSecret || headerToken === cronSecret));
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({error: "unauthorized"}, {status: 401});
  try {
    return NextResponse.json(await runCheckQueuePump(), {status: 202});
  } catch (error) {
    console.error("[cron-check] 执行检测队列失败", error instanceof Error ? error.message : "未知错误");
    return NextResponse.json({error: "检测队列暂不可用，将由后续调度恢复"}, {status: 503});
  }
}
