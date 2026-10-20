import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";
import type {ProviderType} from "@/lib/types";

export interface PublicConfig {
  id: string; name: string; model: string; type: ProviderType;
  group_name: string | null; is_maintenance: boolean; enabled: boolean; sync_disabled?: boolean;
}
/** 包含停用配置以保留详情入口，永不读取端点、密钥或请求头。 */
export async function getPublicConfigs(): Promise<PublicConfig[]> {
  const db = createAdminClient();
  const rows: PublicConfig[] = [];
  for (let offset = 0; ; offset += 500) {
    const {data, error} = await db.from("check_configs").select("id,name,model,type,group_name,is_maintenance,enabled").order("id").range(offset, offset + 499);
    if (error) throw new Error("公开监控目录暂不可用");
    rows.push(...(data ?? []) as PublicConfig[]);
    if (!data || data.length < 500) {
      const sync = await db.from("check_configs").select("id,sync_disabled").eq("sync_disabled", true);
      const disabled = new Set((sync.data ?? []).map((row) => row.id));
      return rows.map((row) => ({...row, sync_disabled: disabled.has(row.id)}));
    }
  }
}
