import {NextResponse} from "next/server";

import {getPollingIntervalMs} from "@/lib/core/polling-config";
import {getScheduledCheckDecision, runPollExecution} from "@/lib/core/poll-execution";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;

  if (cronSecret) {
    return bearerToken === cronSecret;
  }

  return Boolean(
    request.headers.get("x-vercel-cron") ||
      request.headers.get("x-cron-secret") ||
      request.headers.get("user-agent")?.startsWith("vercel-cron/")
  );
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({error: "unauthorized"}, {status: 401});
  }

  const pollIntervalMs = getPollingIntervalMs();
  const decision = await getScheduledCheckDecision(pollIntervalMs);

  if (!decision.due) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: decision.reason,
      pollIntervalMs,
      lastCheckedAt: decision.lastCheckedAt,
      source: "cron",
      now: new Date().toISOString(),
    });
  }

  const result = await runPollExecution({
    forceRefreshConfigs: true,
    skipLeadership: true,
    source: "cron",
  });

  return NextResponse.json({
    ok: result.executed,
    skipped: !result.executed,
    reason: result.reason,
    pollIntervalMs,
    lastCheckedAt: decision.lastCheckedAt,
    decisionReason: decision.reason,
    result,
  });
}
