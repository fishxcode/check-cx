import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchModelList } from "@/lib/providers/models-list";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  return data.claims;
}

/**
 * 根据端点和 API Key 拉取上游模型列表。
 * 不区分 Provider 类型：统一走由业务端点推导出的 /models 接口
 * （new-api 等网关对所有协议类型均提供 OpenAI 风格的模型列表）。
 */
export async function POST(request: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { type, endpoint, api_key } = body;

    if (!type || !endpoint || !api_key) {
      return NextResponse.json({ error: "缺少必填字段（type / endpoint / api_key）" }, { status: 400 });
    }

    const models = await fetchModelList({ type, endpoint, apiKey: api_key });
    return NextResponse.json({ models });
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("Invalid URL")) {
      return NextResponse.json({ error: "端点格式无效" }, { status: 400 });
    }
    console.error("获取模型列表失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取模型列表失败" },
      { status: 500 }
    );
  }
}
