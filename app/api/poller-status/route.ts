import { NextResponse } from "next/server";
import { getLastPingStartedAt, getPollerRole, isPollerRunning, type PollerRole } from "@/lib/core/global-state";
import { getPollingIntervalLabel, getPollingIntervalMs } from "@/lib/core/polling-config";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/poller-status
 * 对外暴露定时检测的运行状态（无需认证，供前台展示）
 *
 * 返回：
 * - running: 当前是否正在执行检测
 * - lastStartedAt: 最近一次检测开始时间
 * - intervalMs: 轮询间隔（毫秒）
 * - intervalLabel: 轮询间隔（人类可读）
 * - nextExpectedAt: 预计下次检测时间（上次开始 + 间隔）
 * - role: 当前节点角色（leader/standby）
 */
export async function GET() {
  const running = isPollerRunning();
  const lastStartedAtMs = getLastPingStartedAt();
  const intervalMs = getPollingIntervalMs();
  const intervalLabel = getPollingIntervalLabel();
  const role: PollerRole = getPollerRole();

  const lastStartedAt = lastStartedAtMs ? new Date(lastStartedAtMs).toISOString() : null;
  const nextExpectedAt =
    lastStartedAtMs && !running
      ? new Date(lastStartedAtMs + intervalMs).toISOString()
      : null;

  // 从最近一条历史获取实际最近检测时间（比 globalThis 更可靠，跨实例）
  let lastCheckedAt: string | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("check_history")
      .select("checked_at")
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lastCheckedAt = data?.checked_at ?? null;
  } catch {
    // 静默失败，不阻塞状态返回
  }

  return NextResponse.json({
    running,
    lastStartedAt,
    lastCheckedAt,
    nextExpectedAt,
    intervalMs,
    intervalLabel,
    role,
    source: "poller-status",
  });
}
