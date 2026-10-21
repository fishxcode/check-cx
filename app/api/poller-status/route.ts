import { NextResponse } from "next/server";
import {withPublicResponseCache} from "@/lib/core/public-response-cache";
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
async function loadLegacyStatus() {
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
    const admin = createAdminClient({requestTimeoutMs: 5_000});
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

  return {
    running,
    lastStartedAt,
    lastCheckedAt,
    nextExpectedAt,
    intervalMs,
    intervalLabel,
    role,
    source: "poller-status",
  };
}


type StatusSnapshot = Awaited<ReturnType<typeof loadLegacyStatus>>;
let cached: {value: StatusSnapshot; expiresAt: number} | undefined;
let inflight: Promise<StatusSnapshot> | undefined;

async function loadStatus(): Promise<StatusSnapshot> {
  try {
    const admin = createAdminClient({requestTimeoutMs: 5_000});
    const {data: run, error} = await admin.from("check_queue_runs")
      .select("status,created_at,interval_seconds")
      .order("created_at", {ascending: false}).limit(1).maybeSingle();
    if (!error && run) {
      const latest = await admin.from("check_history").select("checked_at")
        .order("checked_at", {ascending: false}).limit(1).maybeSingle();
      const setting = await admin.from("site_settings").select("value")
        .eq("key", "check_poll_interval_seconds").maybeSingle();
      if (setting.error) throw new Error("读取检测周期失败");
      const raw = setting.data?.value ?? "";
      const parsed = /^[0-9]{1,4}$/.test(raw) ? Number(raw) : 0;
      const seconds = parsed >= 60 && parsed <= 3600 ? parsed : 1800;
      const intervalMs = seconds * 1000;
      const nextAt = Date.parse(run.created_at) + intervalMs;
      return {
        running: run.status === "running", lastStartedAt: run.created_at,
        lastCheckedAt: latest.data?.checked_at ?? null,
        nextExpectedAt: run.status === "running" ? null : new Date(nextAt).toISOString(),
        intervalMs, intervalLabel: seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`,
        role: "leader", source: "queue",
      };
    }
  } catch { /* 迁移前或队列暂不可用时保留原状态接口。 */ }
  return loadLegacyStatus();
}

async function loadStatusResponse() {
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.value, {headers: {"Cache-Control": "public, max-age=15"}});
  }
  inflight ??= loadStatus().then((value) => {
    cached = {value, expiresAt: Date.now() + 15_000};
    return value;
  }).finally(() => { inflight = undefined; });
  return NextResponse.json(await inflight, {headers: {"Cache-Control": "public, max-age=15"}});
}

export async function GET(request: Request) {
  return withPublicResponseCache(request, "poller-status", loadStatusResponse, 15);
}
