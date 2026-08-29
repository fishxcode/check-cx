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

export async function POST(request: NextRequest) {
  if (!(await requireAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { ids, duration, until, reason } = body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids is required and must be a non-empty array" }, { status: 400 });
  }

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
  const updateData: Record<string, unknown> = { paused_until: pausedUntil };
  if (reason) {
    updateData.pause_reason = reason;
  }

  const { error, count } = await admin.from("check_configs").update(updateData).in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  clearPingCache();
  clearDashboardDataCache();
  clearGroupDashboardCache();
  clearAvailabilityStatsCache();

  return NextResponse.json({ ok: true, count });
}
