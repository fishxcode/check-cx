import { createClient } from "@supabase/supabase-js";

import type { CheckResult } from "@/lib/checks";

const HISTORY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_POINTS_PER_PROVIDER = 60; // roughly 1 point/minute

export type HistoryMap = Record<string, CheckResult[]>;

// 创建 Supabase 客户端（服务端）
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("缺少 Supabase 配置环境变量");
  }

  return createClient(supabaseUrl, supabaseKey);
}

export async function loadHistory(): Promise<HistoryMap> {
  try {
    const supabase = getSupabaseClient();
    const cutoff = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();

    // 从数据库查询最近 1 小时内的记录
    const { data, error } = await supabase
      .from("check_history")
      .select("*")
      .gte("checked_at", cutoff)
      .order("checked_at", { ascending: false })
      .limit(MAX_POINTS_PER_PROVIDER * 10); // 预留足够的数据

    if (error) {
      console.error("[check-cx] 从数据库读取历史记录失败", error);
      return {};
    }

    // 转换为 HistoryMap 格式
    const history: HistoryMap = {};
    for (const record of data || []) {
      const result: CheckResult = {
        id: record.provider_id,
        name: record.provider_name,
        type: record.provider_type,
        endpoint: record.endpoint,
        model: record.model,
        status: record.status as "operational" | "degraded" | "failed",
        latencyMs: record.latency_ms,
        checkedAt: record.checked_at,
        message: record.message,
      };

      if (!history[result.id]) {
        history[result.id] = [];
      }
      history[result.id].push(result);
    }

    // 对每个提供商的记录进行排序和限制
    for (const key of Object.keys(history)) {
      history[key] = history[key]
        .sort(
          (a, b) =>
            new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()
        )
        .slice(0, MAX_POINTS_PER_PROVIDER);

      if (history[key].length === 0) {
        delete history[key];
      }
    }

    return history;
  } catch (error) {
    console.error("[check-cx] 读取历史记录失败", error);
    return {};
  }
}

export async function appendHistory(
  results: CheckResult[]
): Promise<HistoryMap> {
  if (results.length === 0) {
    return loadHistory();
  }

  try {
    const supabase = getSupabaseClient();

    // 将结果写入数据库
    const records = results.map((result) => ({
      provider_id: result.id,
      provider_name: result.name,
      provider_type: result.type,
      endpoint: result.endpoint,
      model: result.model,
      status: result.status,
      latency_ms: result.latencyMs,
      checked_at: result.checkedAt,
      message: result.message,
    }));

    const { error } = await supabase.from("check_history").insert(records);

    if (error) {
      console.error("[check-cx] 写入数据库失败", error);
    }

    // 清理超出限制的数据（每个提供商只保留最新 60 条记录）
    try {
      // 获取所有唯一的 provider_id
      const { data: providers, error: providerError } = await supabase
        .from("check_history")
        .select("provider_id")
        .order("provider_id");

      if (providerError) {
        console.error("[check-cx] 查询 provider_id 失败", providerError);
      } else if (providers) {
        // 去重获取唯一的 provider_id
        const uniqueProviders = [
          ...new Set(providers.map((p) => p.provider_id)),
        ];

        // 对每个提供商，删除超出限制的旧记录
        for (const providerId of uniqueProviders) {
          // 获取该提供商的所有记录，按时间倒序
          const { data: records, error: recordError } = await supabase
            .from("check_history")
            .select("id, checked_at")
            .eq("provider_id", providerId)
            .order("checked_at", { ascending: false });

          if (recordError) {
            console.error(
              `[check-cx] 查询 provider ${providerId} 的记录失败`,
              recordError
            );
            continue;
          }

          // 如果超过 60 条，删除多余的旧记录
          if (records && records.length > MAX_POINTS_PER_PROVIDER) {
            const recordsToDelete = records
              .slice(MAX_POINTS_PER_PROVIDER)
              .map((r) => r.id);

            const { error: deleteError } = await supabase
              .from("check_history")
              .delete()
              .in("id", recordsToDelete);

            if (deleteError) {
              console.error(
                `[check-cx] 删除 provider ${providerId} 的旧记录失败`,
                deleteError
              );
            }
          }
        }
      }
    } catch (cleanupError) {
      console.error("[check-cx] 清理数据时发生错误", cleanupError);
    }

    return loadHistory();
  } catch (error) {
    console.error("[check-cx] 追加历史记录失败", error);
    return loadHistory();
  }
}
