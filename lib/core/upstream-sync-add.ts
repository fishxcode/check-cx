import "server-only";

import {createAdminClient} from "@/lib/supabase/admin";
import {fetchCompleteModelSnapshot} from "@/lib/providers/model-snapshot";
import {clearAllCaches} from "./cache-invalidation";
import {runChecksForConfigs} from "./config-check-execution";
import type {ProviderConfig, ProviderType} from "@/lib/types";

interface SelectedRow {
  id: string;
  type: string;
  model: string;
  endpoint: string;
  api_key: string;
  group_name: string | null;
  request_header: unknown;
  metadata: unknown;
  stream_mode: "stream" | "generate" | null;
  enabled: boolean;
  is_maintenance: boolean;
  sync_enabled: boolean;
}

interface SourceGroup {
  type: string;
  endpoint: string;
  api_key: string;
  group_name: string | null;
  request_header: Record<string, string> | null;
  /** 继承字段取该来源分组下选中的第一条配置 */
  base: SelectedRow;
}

export interface UpstreamDiff {
  type: string;
  endpoint: string;
  groupName: string | null;
  /** 中转站有、本地该来源分组还没有的模型（可补齐创建） */
  toCreate: string[];
  /** 本地有、中转站已移除的模型 */
  missing: string[];
  /** 两边都有的模型数量 */
  presentCount: number;
  /** 上游不可用（拉取快照失败）时为 true，此时 toCreate/missing 为空 */
  unavailable: boolean;
  createBase: {
    request_header: unknown;
    metadata: unknown;
    stream_mode: "stream" | "generate" | null;
    enabled: boolean;
    is_maintenance: boolean;
  };
}

/** 服务端内部差异：比 UpstreamDiff 多携带真实 api_key，绝不返回给前端。 */
interface InternalDiff extends UpstreamDiff {
  api_key: string;
}

function normalizeHeaders(value: unknown): Record<string, string> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string") out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

/** 从选中的配置中提取中转站来源分组（type+endpoint+api_key+group_name）。 */
async function loadSources(admin: ReturnType<typeof createAdminClient>, ids: string[]): Promise<SourceGroup[]> {
  const {data, error} = await admin.from("check_configs")
    .select("id,type,model,endpoint,api_key,group_name,request_header,metadata,stream_mode,enabled,is_maintenance,sync_enabled")
    .in("id", ids);
  if (error) throw new Error("读取配置失败");
  const byKey = new Map<string, SourceGroup>();
  for (const row of (data ?? []) as SelectedRow[]) {
    const key = JSON.stringify([row.type, row.endpoint, row.api_key, row.group_name]);
    const existing = byKey.get(key);
    const header = normalizeHeaders(row.request_header);
    if (!existing) {
      byKey.set(key, {type: row.type, endpoint: row.endpoint, api_key: row.api_key,
        group_name: row.group_name, request_header: header, base: row});
    } else if (existing.request_header === null && header !== null) {
      existing.request_header = header;
    }
  }
  return [...byKey.values()];
}

function createBaseOf(source: SourceGroup): UpstreamDiff["createBase"] {
  return {
    request_header: normalizeHeaders(source.base.request_header),
    metadata: source.base.metadata,
    stream_mode: source.base.stream_mode,
    enabled: source.base.enabled,
    is_maintenance: source.base.is_maintenance,
  };
}

/** 对每个来源分组：拉取中转站模型快照，与本地该来源分组全部配置对比。 */
async function computeDiffs(admin: ReturnType<typeof createAdminClient>, sources: SourceGroup[]): Promise<InternalDiff[]> {
  const diffs: InternalDiff[] = [];
  for (const source of sources) {
    // 本地基线：该来源分组下全部配置的模型（不只选中的），避免把已存在但未勾选的模型重复创建。
    let q = admin.from("check_configs").select("model")
      .eq("type", source.type).eq("endpoint", source.endpoint).eq("api_key", source.api_key);
    q = source.group_name ? q.eq("group_name", source.group_name) : q.is("group_name", null);
    const {data: localRows, error: localError} = await q;
    if (localError) throw new Error("读取本地配置失败");
    const existing = new Set((localRows ?? []).map((row) => row.model as string));

    let snapshot: Set<string> | null = null;
    try {
      snapshot = await fetchCompleteModelSnapshot({type: source.type, endpoint: source.endpoint,
        api_key: source.api_key, request_header: source.request_header});
    } catch {
      // 上游不可用：无法判定新增/缺失。
    }

    if (!snapshot) {
      diffs.push({type: source.type, endpoint: source.endpoint, groupName: source.group_name,
        api_key: source.api_key, toCreate: [], missing: [], presentCount: 0, unavailable: true,
        createBase: createBaseOf(source)});
      continue;
    }

    const toCreate = [...snapshot].filter((m) => !existing.has(m)).sort();
    const missing = [...existing].filter((m) => !snapshot.has(m)).sort();
    const presentCount = [...existing].filter((m) => snapshot.has(m)).length;
    diffs.push({type: source.type, endpoint: source.endpoint, groupName: source.group_name,
      api_key: source.api_key, toCreate, missing, presentCount, unavailable: false,
      createBase: createBaseOf(source)});
  }
  return diffs;
}

function toPublic(diff: InternalDiff): UpstreamDiff {
  const {api_key: _apiKey, ...rest} = diff;
  return rest;
}

/** 以选中的配置作为来源，预览与中转站的模型差异。不写库。 */
export async function previewUpstreamAdd(ids: string[]): Promise<UpstreamDiff[]> {
  const admin = createAdminClient();
  const sources = await loadSources(admin, ids);
  const diffs = await computeDiffs(admin, sources);
  return diffs.map(toPublic);
}

/**
 * 应用同步补齐：批量创建上游新增的模型配置（继承来源字段）；
 * 对上游已移除、且已纳入自动同步的本地配置沿用连续缺失停用机制。
 */
export async function applyUpstreamAdd(ids: string[]): Promise<{
  created: number; disabled: number; unavailable: boolean; diffs: UpstreamDiff[];
}> {
  const admin = createAdminClient();
  const sources = await loadSources(admin, ids);
  const diffs = await computeDiffs(admin, sources);
  let created = 0;
  let disabled = 0;
  let unavailable = true;
  const createdConfigs: ProviderConfig[] = [];

  for (const diff of diffs) {
    unavailable = unavailable && diff.unavailable;

    if (diff.toCreate.length) {
      const rows = diff.toCreate.map((model) => ({
        name: `${diff.type.toUpperCase()} ${model}`,
        type: diff.type,
        model,
        endpoint: diff.endpoint,
        api_key: diff.api_key,
        enabled: diff.createBase.enabled,
        is_maintenance: diff.createBase.is_maintenance,
        group_name: diff.groupName,
        request_header: diff.createBase.request_header,
        metadata: diff.createBase.metadata,
        stream_mode: diff.createBase.stream_mode,
      }));
      const {data, error} = await admin.from("check_configs").insert(rows).select("id");
      if (error) throw new Error("创建新增配置失败");
      created += data.length;
      if (diff.createBase.enabled && !diff.createBase.is_maintenance) {
        data.forEach((row, index) => {
          createdConfigs.push({
            id: row.id,
            name: rows[index].name,
            type: diff.type as ProviderType,
            model: rows[index].model,
            endpoint: diff.endpoint,
            apiKey: diff.api_key,
            is_maintenance: diff.createBase.is_maintenance,
            requestHeaders: diff.createBase.request_header as ProviderConfig["requestHeaders"],
            metadata: diff.createBase.metadata as ProviderConfig["metadata"],
            groupName: diff.groupName,
            streamMode: diff.createBase.stream_mode,
          });
        });
      }
    }

    // 上游已移除：对已纳入自动同步的配置沿用连续缺失停用。
    if (diff.missing.length) {
      let q = admin.from("check_configs").select("id,model,sync_enabled,updated_at")
        .eq("type", diff.type).eq("endpoint", diff.endpoint).eq("api_key", diff.api_key)
        .in("model", diff.missing);
      q = diff.groupName ? q.eq("group_name", diff.groupName) : q.is("group_name", null);
      const {data: localRows, error: localError} = await q;
      if (!localError) {
        for (const row of (localRows ?? []) as {id: string; sync_enabled: boolean; updated_at: string | null}[]) {
          if (!row.sync_enabled) continue;
          const claimed = await admin.rpc("claim_upstream_sync", {p_ids: [row.id], p_limit: 1});
          if (claimed.error || !claimed.data?.length) continue;
          const applied = await admin.rpc("apply_upstream_sync", {
            p_id: row.id,
            p_claim_token: claimed.data[0].sync_claim_token,
            p_expected_updated_at: claimed.data[0].updated_at,
            p_present: false,
          });
          if (!applied.error) disabled++;
        }
      }
    }
  }

  if (created > 0 || disabled > 0) clearAllCaches();
  if (createdConfigs.length) void runChecksForConfigs(createdConfigs).catch(() => {});
  return {created, disabled, unavailable, diffs: diffs.map(toPublic)};
}
