import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

interface ConfigIdentity {
  type: string;
  endpoint: string;
  api_key: string;
  group_name: string | null;
  models: string[];
}

export const DUPLICATE_CONFIG_MESSAGE =
  "相同类型、模型、端点、API Key 和分组的配置已存在，请勿重复添加";

/** 新增入口共用的重复检查；密钥仅用于服务端查询，不返回客户端。 */
export async function checkConfigDuplicate(
  admin: ReturnType<typeof createAdminClient>,
  identity: ConfigIdentity,
): Promise<{ duplicate: boolean; error: boolean }> {
  // 分段查询，避免批量模型较多时超过请求 URL 长度限制。
  for (let offset = 0; offset < identity.models.length; offset += 50) {
    let query = admin
      .from("check_configs")
      .select("id")
      .eq("type", identity.type)
      .eq("endpoint", identity.endpoint)
      .eq("api_key", identity.api_key)
      .in("model", identity.models.slice(offset, offset + 50));

    query = identity.group_name
      ? query.eq("group_name", identity.group_name)
      : query.or("group_name.is.null,group_name.eq.");

    const { data, error } = await query.limit(1);
    if (error) return { duplicate: false, error: true };
    if (data?.length) return { duplicate: true, error: false };
  }
  return { duplicate: false, error: false };
}
