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

    // 清理过期数据（保留最近 1 小时）
    const cutoff = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
    const { error: deleteError } = await supabase
      .from("check_history")
      .delete()
      .lt("checked_at", cutoff);

    if (deleteError) {
      console.error("[check-cx] 清理过期数据失败", deleteError);
    }

    return loadHistory();
  } catch (error) {
    console.error("[check-cx] 追加历史记录失败", error);
    return loadHistory();
  }
}
