/**
 * 轮询主节点选举与租约续租
 */

import "server-only";

import {ensurePollerLeaseRow, releasePollerLease, tryAcquirePollerLease, tryRenewPollerLease} from "../database/poller-lease";
import {logError} from "../utils";
import {getPollerRole, setPollerRole, type PollerRole} from "./global-state";

// 固定租约参数，不暴露环境变量
// 覆盖 Cloudflare Worker 单次请求的最大执行窗口，避免长任务中租约过期。
const LEASE_DURATION_MS = 10 * 60_000;
const DEFAULT_NODE_ID = "local";

let didWarnMissingNodeId = false;
let initPromise: Promise<void> | null = null;

function resolveNodeId(): string {
  const base =
    process.env.CHECK_NODE_ID?.trim() ||
    process.env.HOSTNAME?.trim() ||
    DEFAULT_NODE_ID;
  const nodeId = `${base}:${globalThis.crypto.randomUUID()}`;
  if (!didWarnMissingNodeId) {
    console.warn(
      `[check-cx] 使用 ${nodeId} 作为本次 Worker isolate 的节点身份`
    );
    didWarnMissingNodeId = true;
  }
  return nodeId;
}

const NODE_ID = resolveNodeId();

function setRole(nextRole: PollerRole): void {
  const currentRole = getPollerRole();
  if (currentRole === nextRole) {
    return;
  }
  setPollerRole(nextRole);
  console.log(
    `[check-cx] 节点角色切换：${currentRole} -> ${nextRole} (node=${NODE_ID})`
  );
}

async function refreshLeadership(): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
  const currentRole = getPollerRole();

  if (currentRole === "leader") {
    const renewed = await tryRenewPollerLease(NODE_ID, now, expiresAt);
    if (renewed) {
      return;
    }
    setRole("standby");
  }

  const acquired = await tryAcquirePollerLease(NODE_ID, now, expiresAt);
  if (acquired) {
    setRole("leader");
  }
}

export async function ensurePollerLeadership(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    await ensurePollerLeaseRow();
    await refreshLeadership();
  })().catch((error) => {
    logError("pollerLeadership.refresh", error);
    throw error;
  });

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

export function isPollerLeader(): boolean {
  return getPollerRole() === "leader";
}

export async function releasePollerLeadership(): Promise<boolean> {
  if (!isPollerLeader()) {
    return true;
  }
  const released = await releasePollerLease(NODE_ID);
  if (released) {
    setRole("standby");
  }
  return released;
}

export function getPollerNodeId(): string {
  return NODE_ID;
}
