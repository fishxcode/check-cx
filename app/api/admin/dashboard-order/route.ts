import {NextResponse, type NextRequest} from "next/server";

import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {refreshSiteSettings} from "@/lib/core/site-settings";

const DASHBOARD_GROUP_ORDER_KEY = "dashboard.group_order";

async function requireAuth() {
  const supabase = await createClient();
  const {data} = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

function parseGroupOrder(value: unknown): string[] | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const result = parsed.filter(
      (x): x is string => typeof x === "string" && x.trim().length > 0
    );
    return result.length > 0 ? result : [];
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * 管理端点：获取首页分组排序（全局）
 */
export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({error: "Unauthorized"}, {status: 401});
  }

  const admin = createAdminClient();
  const {data, error} = await admin
    .from("site_settings")
    .select("value")
    .eq("key", DASHBOARD_GROUP_ORDER_KEY)
    .single();

  if (error) {
    return NextResponse.json({error: error.message}, {status: 500});
  }

  return NextResponse.json({groupOrder: parseGroupOrder(data?.value) ?? []});
}

/**
 * 管理端点：更新首页分组排序（全局）
 * body: { groupOrder: string[] }
 */
export async function PUT(request: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({error: "Unauthorized"}, {status: 401});
  }

  const body = await request.json().catch(() => null);
  const groupOrder = body?.groupOrder;

  if (!Array.isArray(groupOrder) || !groupOrder.every((x: unknown) => typeof x === "string")) {
    return NextResponse.json({error: "groupOrder 必须是 string[]"}, {status: 400});
  }

  const normalized = groupOrder.map((x: string) => x.trim()).filter(Boolean);
  const unique = Array.from(new Set(normalized));

  const admin = createAdminClient();
  const {error} = await admin
    .from("site_settings")
    .upsert(
      {
        key: DASHBOARD_GROUP_ORDER_KEY,
        value: JSON.stringify(unique),
        description: "首页分组自定义排序（JSON 数组，存 group_name 列表）",
        editable: false,
        value_type: "json",
      },
      {onConflict: "key"}
    );

  if (error) {
    return NextResponse.json({error: error.message}, {status: 500});
  }

  await refreshSiteSettings({force: true});

  return NextResponse.json({ok: true, groupOrder: unique});
}
