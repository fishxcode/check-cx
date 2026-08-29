import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearPingCache } from "@/lib/core/global-state";
import { clearDashboardDataCache } from "@/lib/core/dashboard-data";
import { clearGroupDashboardCache } from "@/lib/core/group-data";
import { clearAvailabilityStatsCache } from "@/lib/database/availability";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

/**
 * 解析相对时间字符串为毫秒数
 * 支持格式: "15m", "30m", "1h", "6h", "1d"
 */
function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)(m|h|d)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { duration, until, reason } = body;

  let pausedUntil: string;

  if (duration) {
    const durationMs = parseDuration(duration);
    if (durationMs === null) {
      return NextResponse.json({ error: "Invalid duration format" }, { status: 400 });
    }
    pausedUntil = new Date(Date.now() + durationMs).toISOString();
  } else if (until) {
    const untilDate = new Date(until);
    if (isNaN(untilDate.getTime())) {
      return NextResponse.json({ error: "Invalid until timestamp" }, { status: 400 });
    }
    pausedUntil = untilDate.toISOString();
  } else {
    return NextResponse.json({ error: "Either duration or until is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 锁定保护：锁定配置需 force_update 二次确认
  const { data: before } = await admin.from("check_configs").select("locked").eq("id", id).single();
  if (before?.locked && !body.force_update) {
    return NextResponse.json({ error: "配置已锁定，需二次确认", locked: true }, { status: 423 });
  }

  const updateData: Record<string, unknown> = { paused_until: pausedUntil };
  if (reason) {
    updateData.pause_reason = reason;
  }

  const { error } = await admin.from("check_configs").update(updateData).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  clearPingCache();
  clearDashboardDataCache();
  clearGroupDashboardCache();
  clearAvailabilityStatsCache();

  return NextResponse.json({ ok: true, paused_until: pausedUntil });
}
