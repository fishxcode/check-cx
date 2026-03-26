import {NextResponse, type NextRequest} from "next/server";

import {requireAuth} from "../../alerts/_auth";
import {deleteSchedulerToken, setSchedulerTokenEnabled} from "@/lib/database/scheduler-tokens";

interface RouteContext {
  params: Promise<{id: string}>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const err = await requireAuth();
  if (err) {
    return err;
  }

  const {id} = await context.params;
  const body = await request.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({error: "enabled 必须为布尔值"}, {status: 400});
  }

  const ok = await setSchedulerTokenEnabled(id, body.enabled);
  if (!ok) {
    return NextResponse.json({error: "更新 Token 状态失败"}, {status: 500});
  }

  return NextResponse.json({ok: true});
}

export async function DELETE(_: NextRequest, context: RouteContext) {
  const err = await requireAuth();
  if (err) {
    return err;
  }

  const {id} = await context.params;
  const ok = await deleteSchedulerToken(id);
  if (!ok) {
    return NextResponse.json({error: "删除 Token 失败"}, {status: 500});
  }

  return NextResponse.json({ok: true});
}
