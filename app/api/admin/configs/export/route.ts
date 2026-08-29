import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// API Key 脱敏：仅保留末 4 位
const maskKey = (k: string) => "••••" + k.slice(-4);

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

// 轻量 YAML 序列化：字符串统一走 JSON.stringify 保证转义正确，避免引入额外依赖
const safeKey = (k: string) => (/^[A-Za-z_][\w-]*$/.test(k) ? k : JSON.stringify(k));

// 非空对象/数组需换行缩进为块，标量与空集合内联在同一行
const isBlock = (v: unknown) =>
  v !== null && typeof v === "object" && (Array.isArray(v) ? v.length > 0 : Object.keys(v as object).length > 0);

function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        // 块级子项首行已带缩进，去掉后拼到 "- " 之后；标量子项无缩进直接内联
        const child = toYaml(item, indent + 1);
        return isBlock(item) ? `${pad}- ${child.slice((indent + 1) * 2)}` : `${pad}- ${child}`;
      })
      .join("\n");
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return entries
    .map(([k, v]) => {
      const key = `${pad}${safeKey(k)}:`;
      return isBlock(v) ? `${key}\n${toYaml(v, indent + 1)}` : `${key} ${toYaml(v, indent + 1)}`;
    })
    .join("\n");
}

export async function GET(request: NextRequest) {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids");
  const includeHistory = searchParams.get("include_history") === "true";
  const format = searchParams.get("format") === "yaml" ? "yaml" : "json";
  const ids = idsParam ? idsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const admin = createAdminClient();

  // 查询配置：有 ids 则仅导出选中项，否则导出全部
  let query = admin
    .from("check_configs")
    .select("id,name,type,model,endpoint,api_key,enabled,is_maintenance,group_name,request_header,metadata,stream_mode,tags,created_at")
    .order("created_at", { ascending: false });
  if (ids.length > 0) query = query.in("id", ids);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 脱敏 api_key
  const configs = (data ?? []).map((row) => ({ ...row, api_key: maskKey(row.api_key) }));

  // 可选：为每个配置附加最近 10 条历史记录（并发拉取）
  if (includeHistory) {
    await Promise.all(
      configs.map(async (config) => {
        const { data: history } = await admin
          .from("check_history")
          .select("status,latency_ms,ping_latency_ms,checked_at,message")
          .eq("config_id", config.id)
          .order("checked_at", { ascending: false })
          .limit(10);
        (config as Record<string, unknown>).history = history ?? [];
      })
    );
  }

  const payload = {
    exported_at: new Date().toISOString(),
    count: configs.length,
    configs,
  };

  // 使用 new Response 以便设置下载头
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const isYaml = format === "yaml";
  const body = isYaml ? toYaml(payload) : JSON.stringify(payload, null, 2);
  return new Response(body, {
    headers: {
      "Content-Type": isYaml ? "text/yaml; charset=utf-8" : "application/json",
      "Content-Disposition": `attachment; filename="check-cx-export-${timestamp}.${isYaml ? "yaml" : "json"}"`,
    },
  });
}
