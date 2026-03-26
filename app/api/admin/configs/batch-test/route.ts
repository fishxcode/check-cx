import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "../../alerts/_auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProviderConfig, ProviderType } from "@/lib/types";
import { runChecksForConfigs } from "@/lib/core/config-check-execution";

export async function POST(request: NextRequest) {
  const err = await requireAuth();
  if (err) return err;

  const body = await request.json();
  const ids: string[] = body?.ids ?? [];
  if (!ids.length) return NextResponse.json({ error: "ids 不能为空" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("check_configs")
    .select("id,name,type,model,endpoint,api_key,is_maintenance,request_header,metadata,group_name")
    .in("id", ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const configs: ProviderConfig[] = (data ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type as ProviderType,
    endpoint: d.endpoint,
    model: d.model,
    apiKey: d.api_key,
    is_maintenance: d.is_maintenance,
    requestHeaders: (d.request_header as Record<string, string>) || null,
    metadata: (d.metadata as Record<string, unknown>) || null,
    groupName: d.group_name || null,
  }));

  const results = await runChecksForConfigs(configs);

  const resultMap = Object.fromEntries(
    results.map((r) => [r.id, { status: r.status, latencyMs: r.latencyMs, message: r.message ?? null }])
  );
  return NextResponse.json(resultMap);
}
