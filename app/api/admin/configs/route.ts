import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearPingCache } from "@/lib/core/global-state";
import { normalizeTags, validateOptionalInt, CHECK_INTERVAL_RANGE, LATENCY_THRESHOLD_RANGE } from "@/lib/utils/config-validation";

function maskKey(key: string) {
  return "••••" + key.slice(-4);
}

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  return data.claims;
}

export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("check_configs")
    .select("id,name,type,model,endpoint,api_key,enabled,is_maintenance,group_name,request_header,metadata,stream_mode,tags,locked,locked_at,lock_reason,paused_until,check_interval_override,latency_threshold_ms,next_check_at,created_at,updated_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const masked = data.map((row) => ({ ...row, api_key: maskKey(row.api_key) }));
  return NextResponse.json(masked);
}

export async function POST(request: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const { name, type, model, endpoint, api_key, enabled, is_maintenance, group_name, request_header, metadata, stream_mode, tags, check_interval_override, latency_threshold_ms } = body;
  if (!name || !type || !model || !endpoint || !api_key) {
    return NextResponse.json({ error: "缺少必填字段" }, { status: 400 });
  }

  const intervalCheck = validateOptionalInt(check_interval_override, CHECK_INTERVAL_RANGE.min, CHECK_INTERVAL_RANGE.max);
  if ("error" in intervalCheck) return NextResponse.json({ error: `检查间隔${intervalCheck.error}` }, { status: 400 });
  const thresholdCheck = validateOptionalInt(latency_threshold_ms, LATENCY_THRESHOLD_RANGE.min, LATENCY_THRESHOLD_RANGE.max);
  if ("error" in thresholdCheck) return NextResponse.json({ error: `延迟阈值${thresholdCheck.error}` }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("check_configs")
    .insert({
      name, type, model, endpoint, api_key,
      enabled: enabled ?? true,
      is_maintenance: is_maintenance ?? false,
      group_name: group_name || null,
      request_header: request_header || null,
      metadata: metadata || null,
      stream_mode: stream_mode || null,
      tags: normalizeTags(tags),
      check_interval_override: intervalCheck.value,
      latency_threshold_ms: thresholdCheck.value,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 清理后端缓存，让前台重新获取最新配置
  clearPingCache();

  return NextResponse.json({ id: data.id }, { status: 201 });
}
