import {NextResponse, type NextRequest} from "next/server";

import {requireAuth} from "../alerts/_auth";
import {createSchedulerToken, listSchedulerTokens} from "@/lib/database/scheduler-tokens";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const err = await requireAuth();
  if (err) {
    return err;
  }

  return NextResponse.json(await listSchedulerTokens());
}

export async function POST(request: NextRequest) {
  const err = await requireAuth();
  if (err) {
    return err;
  }

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  if (!name) {
    return NextResponse.json({error: "name 不能为空"}, {status: 400});
  }

  const created = await createSchedulerToken(name);
  if (!created) {
    return NextResponse.json({error: "创建 Token 失败"}, {status: 500});
  }

  return NextResponse.json(created, {status: 201});
}
