import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "../../alerts/_auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runProviderChecks } from "@/lib/providers";
import { appendHistory } from "@/lib/database/history";
import { evaluateAlerts } from "@/lib/core/alert-engine";
import { sendPollSummary } from "@/lib/core/poll-summary";
import { clearPingCache } from "@/lib/core/global-state";
import { clearDashboardDataCache } from "@/lib/core/dashboard-data";
import { clearGroupDashboardCache } from "@/lib/core/group-data";
import type { ProviderConfig, ProviderType } from "@/lib/types";

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

  const results = await runProviderChecks(configs);

  // 写入历史记录
  await appendHistory(results);

  // 逐条告警评估
  await Promise.allSettled(
    results.map((r) => evaluateAlerts(r.id, r.name, r.status, r.latencyMs ?? null))
  );

  // 批量检测汇总通知
  await sendPollSummary(results).catch(() => {});

  // 批量手动检测后立即失效缓存，确保前台下一次拉取看到最新结果
  clearPingCache();
  clearDashboardDataCache();
  clearGroupDashboardCache();

  const resultMap = Object.fromEntries(
    results.map((r) => [r.id, { status: r.status, latencyMs: r.latencyMs, message: r.message ?? null }])
  );
  return NextResponse.json(resultMap);
}
