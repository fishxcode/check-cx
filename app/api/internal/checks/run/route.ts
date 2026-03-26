import {NextResponse, type NextRequest} from "next/server";

import {createAdminClient} from "@/lib/supabase/admin";
import {runChecksForConfigs} from "@/lib/core/config-check-execution";
import {loadProviderConfigsFromDB} from "@/lib/database/config-loader";
import {
  touchSchedulerToken,
  verifySchedulerToken,
} from "@/lib/database/scheduler-tokens";
import type {ProviderConfig, ProviderType} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

interface RunChecksRequestBody {
  ids?: string[];
  failOnIssues?: boolean;
}

function getBearerToken(request: NextRequest): string {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return "";
  }
  return authorization.slice("Bearer ".length).trim();
}

function mapConfig(row: Record<string, unknown>): ProviderConfig {
  return {
    id: String(row.id),
    name: String(row.name),
    type: row.type as ProviderType,
    endpoint: String(row.endpoint),
    model: String(row.model),
    apiKey: String(row.api_key),
    is_maintenance: Boolean(row.is_maintenance),
    requestHeaders: (row.request_header as Record<string, string>) || null,
    metadata: (row.metadata as Record<string, unknown>) || null,
    groupName: (row.group_name as string | null) || null,
  };
}

async function loadConfigsByIds(ids: string[]): Promise<ProviderConfig[]> {
  const admin = createAdminClient();
  const {data, error} = await admin
    .from("check_configs")
    .select("id,name,type,model,endpoint,api_key,is_maintenance,request_header,metadata,group_name")
    .in("id", ids)
    .order("name");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapConfig(row as Record<string, unknown>));
}

export async function POST(request: NextRequest) {
  const token = getBearerToken(request);
  const tokenRecord = await verifySchedulerToken(token);
  if (!tokenRecord) {
    return NextResponse.json({error: "unauthorized"}, {status: 401});
  }

  const body = await request.json().catch(() => ({} as RunChecksRequestBody));
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const failOnIssues = body.failOnIssues !== false;

  const configs = ids.length > 0
    ? await loadConfigsByIds(ids)
    : await loadProviderConfigsFromDB({forceRefresh: true});

  if (ids.length > 0 && configs.length === 0) {
    return NextResponse.json({error: "未找到指定配置"}, {status: 404});
  }

  const results = await runChecksForConfigs(configs);
  await touchSchedulerToken(tokenRecord.id);

  const issueResults = results.filter((result) =>
    ["failed", "validation_failed", "error"].includes(result.status)
  );
  const degradedResults = results.filter((result) => result.status === "degraded");

  const payload = {
    ok: issueResults.length === 0,
    source: "scheduler-token",
    tokenName: tokenRecord.name,
    total: results.length,
    issueCount: issueResults.length,
    degradedCount: degradedResults.length,
    results: results.map((result) => ({
      id: result.id,
      name: result.name,
      status: result.status,
      latencyMs: result.latencyMs,
      pingLatencyMs: result.pingLatencyMs,
      checkedAt: result.checkedAt,
      message: result.message ?? null,
    })),
  };

  if (failOnIssues && issueResults.length > 0) {
    return NextResponse.json(payload, {status: 503});
  }

  return NextResponse.json(payload);
}
