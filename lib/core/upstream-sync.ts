import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";
import {fetchCompleteModelSnapshot, type ModelSnapshotSource} from "@/lib/providers/model-snapshot";
import {getModelPricingMetadata} from "./model-pricing";
import {clearAllCaches} from "./cache-invalidation";

interface SyncConfig extends ModelSnapshotSource {
  id: string; name: string; model: string; group_name: string | null;
  updated_at: string | null; sync_claim_token: string;
  sync_missing_count: number; sync_disabled: boolean;
}
export interface SyncResult {
  id: string; name: string; model: string; groupName: string | null;
  state: "present" | "missing" | "unavailable" | "stale";
  missingCount: number; syncDisabled: boolean;
  groupDifference?: {configured: string; availableGroups: string[]};
}

export async function runUpstreamSync({ids, preview = false}: {ids?: string[]; preview?: boolean} = {}): Promise<SyncResult[]> {
  const db = createAdminClient();
  if (preview && (!ids?.length || ids.length > 200)) throw new Error("请选择 1 至 200 条配置");
  const response = preview
    ? await db.from("check_configs").select("*").eq("sync_enabled", true).in("id", ids!)
    : await db.rpc("claim_upstream_sync", {p_ids: ids ?? null, p_limit: 200});
  if (response.error) throw new Error("同步功能尚未就绪或读取失败");
  const groups = new Map<string, SyncConfig[]>();
  for (const row of (response.data ?? []) as SyncConfig[]) {
    // 凭证只作为内存去重键，绝不返回或写入日志。
    const headers = Object.entries(row.request_header ?? {}).sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify([row.type, row.endpoint, row.api_key, row.group_name, headers]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const queue = [...groups.values()];
  const results: SyncResult[] = [];
  let changed = false;
  async function worker() {
    while (queue.length) {
      const group = queue.shift()!;
      let models: Set<string> | null = null;
      try { models = await fetchCompleteModelSnapshot(group[0]); } catch { /* 失败不累计缺失，领取时间提供退避。 */ }
      for (const row of group) {
        const present = models?.has(row.model) ?? false;
        const result: SyncResult = {id: row.id, name: row.name, model: row.model, groupName: row.group_name,
          state: models ? present ? "present" : "missing" : "unavailable",
          missingCount: row.sync_missing_count, syncDisabled: row.sync_disabled};
        let pricingSource = false;
        try { pricingSource = new URL(row.endpoint).hostname === "fishxcode.com"; } catch { /* 无效地址保留 unavailable 结果。 */ }
        if (preview && row.group_name && pricingSource) {
          const pricing = await getModelPricingMetadata(row.model);
          if (pricing?.groups.length && !pricing.groups.includes(row.group_name)) {
            result.groupDifference = {configured: row.group_name, availableGroups: pricing.groups};
          }
        }
        if (models && !preview) {
          const applied = await db.rpc("apply_upstream_sync", {p_id: row.id, p_claim_token: row.sync_claim_token, p_expected_updated_at: row.updated_at, p_present: present});
          if (applied.error) result.state = "unavailable";
          else if (applied.data !== true) result.state = "stale";
          else {
            result.missingCount = present ? 0 : Math.min(row.sync_missing_count + 1, 2);
            result.syncDisabled = !present && result.missingCount >= 2;
            changed = true;
          }
        }
        results.push(result);
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(3, queue.length)}, worker));
  if (changed) clearAllCaches();
  return results;
}

let nextAttempt = 0;
let inflight: Promise<void> | undefined;
/** 定时入口必须在没有活跃检测配置时仍可运行，以便自动恢复。 */
export async function runUpstreamSyncIfDue() {
  if (inflight) return inflight;
  if (Date.now() < nextAttempt) return;
  nextAttempt = Date.now() + 60_000;
  inflight = runUpstreamSync().then(() => undefined).catch(() => undefined).finally(() => { inflight = undefined; });
  return inflight;
}
