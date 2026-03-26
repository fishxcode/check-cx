import "server-only";

import {createHash, randomBytes} from "crypto";

import {createAdminClient} from "@/lib/supabase/admin";
import {logError} from "@/lib/utils";

const TOKEN_SCOPE = "checks:run";
const TOKEN_PREFIX = "ckcx_sk_";
const TOKEN_VISIBLE_PREFIX_LENGTH = 16;

export interface SchedulerTokenRecord {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: string;
  enabled: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface SchedulerTokenRow {
  id: string;
  name: string;
  token_prefix: string;
  scope: string;
  enabled: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mapRow(row: SchedulerTokenRow): SchedulerTokenRecord {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scope: row.scope,
    enabled: row.enabled,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function generateSchedulerToken(): {
  rawToken: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const secret = randomBytes(24).toString("base64url");
  const rawToken = `${TOKEN_PREFIX}${secret}`;
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    tokenPrefix: rawToken.slice(0, TOKEN_VISIBLE_PREFIX_LENGTH),
  };
}

export async function listSchedulerTokens(): Promise<SchedulerTokenRecord[]> {
  const admin = createAdminClient();
  const {data, error} = await admin
    .from("scheduler_tokens")
    .select("id,name,token_prefix,scope,enabled,last_used_at,expires_at,created_at")
    .order("created_at", {ascending: false});

  if (error) {
    logError("读取调度 Token 列表失败", error);
    return [];
  }

  return (data ?? []).map((row) => mapRow(row as SchedulerTokenRow));
}

export async function createSchedulerToken(name: string): Promise<{
  record: SchedulerTokenRecord;
  rawToken: string;
} | null> {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return null;
  }

  const {rawToken, tokenHash, tokenPrefix} = generateSchedulerToken();
  const admin = createAdminClient();
  const {data, error} = await admin
    .from("scheduler_tokens")
    .insert({
      name: normalizedName,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      scope: TOKEN_SCOPE,
    })
    .select("id,name,token_prefix,scope,enabled,last_used_at,expires_at,created_at")
    .single();

  if (error || !data) {
    logError("创建调度 Token 失败", error);
    return null;
  }

  return {
    record: mapRow(data as SchedulerTokenRow),
    rawToken,
  };
}

export async function setSchedulerTokenEnabled(
  id: string,
  enabled: boolean
): Promise<boolean> {
  const admin = createAdminClient();
  const {error} = await admin
    .from("scheduler_tokens")
    .update({enabled})
    .eq("id", id);

  if (error) {
    logError("更新调度 Token 状态失败", error);
    return false;
  }

  return true;
}

export async function deleteSchedulerToken(id: string): Promise<boolean> {
  const admin = createAdminClient();
  const {error} = await admin
    .from("scheduler_tokens")
    .delete()
    .eq("id", id);

  if (error) {
    logError("删除调度 Token 失败", error);
    return false;
  }

  return true;
}

export async function verifySchedulerToken(
  token: string
): Promise<SchedulerTokenRecord | null> {
  if (!token) {
    return null;
  }

  const admin = createAdminClient();
  const {data, error} = await admin
    .from("scheduler_tokens")
    .select("id,name,token_prefix,scope,enabled,last_used_at,expires_at,created_at")
    .eq("token_hash", hashToken(token))
    .eq("enabled", true)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      logError("校验调度 Token 失败", error);
    }
    return null;
  }

  const row = data as SchedulerTokenRow;
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return null;
  }

  return mapRow(row);
}

export async function touchSchedulerToken(id: string): Promise<void> {
  const admin = createAdminClient();
  const {error} = await admin
    .from("scheduler_tokens")
    .update({last_used_at: new Date().toISOString()})
    .eq("id", id);

  if (error) {
    logError("更新调度 Token 最近使用时间失败", error);
  }
}
