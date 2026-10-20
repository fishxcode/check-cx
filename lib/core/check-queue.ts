import "server-only";

import {createAdminClient} from "@/lib/supabase/admin";
import type {CheckResult, ProviderConfig} from "@/lib/types";
import {checkWithAiSdk} from "@/lib/providers";
import {HISTORY_RETENTION_DAYS} from "@/lib/database/history";
import {deliverQueuedAlert, planAlerts} from "./alert-engine";
import {sendPollSummary} from "./poll-summary";
import {runOfficialStatusCheckOnce} from "./official-status-poller";

interface QueueTask {
  id: string;
  run_id: string;
  kind: "check" | "alerts" | "alert" | "finish" | "summary" | "official" | "prune";
  config_id: string | null;
  status: "pending" | "running" | "completed" | "failed";
  payload: {result?: CheckResult; ruleId?: string; channelId?: string};
}
interface ChildTask {
  key: string;
  kind: QueueTask["kind"];
  payload?: QueueTask["payload"];
}
interface TaskCompletion {retry: boolean; tasks: string[]; failed?: boolean}

/** 消息只携带 ID；执行状态及后续任务以数据库事务为准。 */
export async function dispatchCheckQueue(event: string): Promise<{tasks: string[]; attemptId: string; intervalSeconds: number}> {
  const {data, error} = await createAdminClient({requestTimeoutMs: 10_000}).rpc("dispatch_check_queue", {
    p_attempt_id: null, p_event: event, p_interval_seconds: null,
  });
  if (error) throw new Error(`创建检测计划失败：${error.code}`);
  return data as {tasks: string[]; attemptId: string; intervalSeconds: number};
}

export async function executeCheckQueueTask(taskId: string): Promise<TaskCompletion> {
  const admin = createAdminClient({requestTimeoutMs: 10_000});
  const owner = crypto.randomUUID();
  const {data, error} = await admin.rpc("claim_check_queue_task", {p_task_id: taskId, p_owner: owner});
  if (error) throw new Error(`领取检测任务失败：${error.code}`);
  const task = (data as QueueTask[] | null)?.[0];
  if (!task) {
    const existing = await admin.from("check_queue_tasks").select("id").eq("id", taskId).maybeSingle();
    if (existing.error) throw new Error(`读取任务状态失败：${existing.error.code}`);
    return {retry: Boolean(existing.data), tasks: []};
  }

  const complete = async (result: CheckResult | null, children: ChildTask[], failure?: string) => {
    const response = await admin.rpc("complete_check_queue_task", {
      p_task_id: task.id, p_owner: owner, p_result: result,
      p_children: children, p_error: failure ?? null,
    });
    if (response.error) throw new Error(`保存检测任务失败：${response.error.code}`);
    return response.data as TaskCompletion;
  };
  // 已完成消息只恢复未投递的后续任务，不再访问模型或发送通知。
  if (task.status === "completed" || task.status === "failed") return complete(null, []);

  try {
    switch (task.kind) {
      case "check": {
        const config = await loadCurrentConfig(task.config_id!, admin);
        const result = config ? await checkWithAiSdk(config, {maxRetries: 0}) : null;
        return await complete(result, []);
      }
      case "alerts": {
        const result = task.payload.result!;
        const deliveries = await planAlerts(result);
        return await complete(null, deliveries.map(({ruleId, channelId}) => ({
          key: `alert:${task.id}:${ruleId}:${channelId}`, kind: "alert",
          payload: {ruleId, channelId, result},
        })));
      }
      case "alert":
        await deliverQueuedAlert(task.payload.ruleId!, task.payload.channelId!, task.payload.result!);
        break;
      case "finish": {
        const {data: setting, error: settingError} = await admin.from("site_settings")
          .select("value").eq("key", "alert.summary_channel_ids").maybeSingle();
        if (settingError) throw new Error(`读取汇总设置失败：${settingError.code}`);
        let channelIds: string[] = [];
        try {
          const parsed: unknown = JSON.parse(setting?.value || "[]");
          if (Array.isArray(parsed)) channelIds = [...new Set(parsed.filter((id): id is string => typeof id === "string"))];
        } catch { /* 无效设置视为未启用汇总。 */ }
        return await complete(null, [
          {key: "official", kind: "official"},
          {key: "prune", kind: "prune"},
          ...channelIds.map((channelId): ChildTask => ({key: `summary:${channelId}`, kind: "summary", payload: {channelId}})),
        ]);
      }
      case "summary": {
        // 一次 RPC 聚合返回 JSON，不受 REST 默认行数上限影响。
        const {data: results, error: resultError} = await admin.rpc("get_check_queue_results", {p_run_id: task.run_id});
        if (resultError) throw new Error(`读取本轮结果失败：${resultError.code}`);
        await sendPollSummary(results as CheckResult[], {channelIds: [task.payload.channelId!], strict: true});
        break;
      }
      case "official":
        await runOfficialStatusCheckOnce({isolated: true});
        break;
      case "prune": {
        const prune = await admin.rpc("prune_check_history", {retention_days: HISTORY_RETENTION_DAYS});
        if (prune.error) throw new Error(`清理检测历史失败：${prune.error.code}`);
        const response = await admin.rpc("prune_check_queue");
        if (response.error) throw new Error(`清理队列任务失败：${response.error.code}`);
        break;
      }
      default:
        throw new Error("未知队列任务类型");
    }
    return await complete(null, []);
  } catch (failure) {
    // 这里只重试基础设施和通知失败，模型健康异常作为结果正常提交。
    return complete(null, [], failure instanceof Error ? failure.message : String(failure));
  }
}

async function loadCurrentConfig(id: string, admin: ReturnType<typeof createAdminClient>): Promise<ProviderConfig | null> {
  const {data: row, error} = await admin.from("check_configs")
    .select("id,name,type,model,endpoint,api_key,enabled,sync_disabled,is_maintenance,request_header,metadata,group_name,stream_mode,paused_until,latency_threshold_ms")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(`读取检测配置失败：${error.code}`);
  if (!row || !row.enabled || row.sync_disabled || row.is_maintenance
    || (row.paused_until && Date.parse(row.paused_until) > Date.now())) return null;
  return {
    id: row.id, name: row.name, type: row.type as ProviderConfig["type"],
    model: row.model, endpoint: row.endpoint, apiKey: row.api_key,
    is_maintenance: row.is_maintenance, requestHeaders: row.request_header,
    metadata: row.metadata, groupName: row.group_name, streamMode: row.stream_mode,
    latencyThresholdMs: row.latency_threshold_ms,
  };
}
