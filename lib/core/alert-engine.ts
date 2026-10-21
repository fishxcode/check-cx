import "server-only";

import { createAdminClient } from "../supabase/admin";
import type { CheckResult, HealthStatus } from "../types";
import type { AlertRuleRow, AlertChannelRow } from "../types/database";
import { shouldTrigger } from "../alerts/conditions";
import { sendWebhook } from "../alerts/webhook";
import { sendFeishu } from "../alerts/feishu";
import { sendDingTalk } from "../alerts/dingtalk";
import { sendPushPlus } from "../alerts/pushplus";
import { logError } from "../utils";

export interface PlannedAlert {ruleId: string; channelId: string}

/** 告警只做决策；发送按单渠道分配独立任务。 */
export async function planAlerts(result: CheckResult): Promise<PlannedAlert[]> {
  const admin = createAdminClient({requestTimeoutMs: 10_000});
  const {data: rules, error} = await admin.from("alert_rules").select("*")
    .eq("enabled", true).or(`config_ids.is.null,config_ids.cs.{${result.id}}`);
  if (error) throw new Error(`读取告警规则失败：${error.code}`);
  if (!rules?.length) return [];
  let history: {status: string}[] = [];
  if (rules.some((rule) => ["status_change", "consecutive_failures"].includes(rule.condition_type))) {
    const response = await admin.from("check_history").select("status")
      .eq("config_id", result.id).lt("checked_at", result.checkedAt)
      .order("checked_at", {ascending: false}).order("id", {ascending: false}).limit(10);
    if (response.error) throw new Error(`读取告警历史失败：${response.error.code}`);
    history = response.data ?? [];
  }
  return (rules as AlertRuleRow[]).flatMap((rule) =>
    shouldTrigger(rule, result.status, result.latencyMs, history)
      ? [...new Set(rule.channel_ids)].map((channelId) => ({ruleId: rule.id, channelId}))
      : []
  );
}

export async function deliverQueuedAlert(ruleId: string, channelId: string, result: CheckResult): Promise<void> {
  const admin = createAdminClient({requestTimeoutMs: 10_000});
  const {data, error} = await admin.from("alert_rules").select("*")
    .eq("id", ruleId).eq("enabled", true).maybeSingle();
  if (error) throw new Error(`读取告警规则失败：${error.code}`);
  const rule = data as AlertRuleRow | null;
  if (!rule || !rule.channel_ids.includes(channelId)
    || (rule.config_ids && !rule.config_ids.includes(result.id))) return;
  await dispatchToChannel(admin, rule, channelId, result.id, result.name, result.status, result.latencyMs, true);
}

export async function evaluateAlerts(
  configId: string,
  configName: string,
  newStatus: HealthStatus,
  latencyMs: number | null
): Promise<void> {
  const supabase = createAdminClient();

  const { data: rules, error: rulesErr } = await supabase
    .from("alert_rules")
    .select("*")
    .eq("enabled", true)
    .or(`config_ids.is.null,config_ids.cs.{${configId}}`);

  if (rulesErr) { logError("查询告警规则失败", rulesErr); return; }
  if (!rules?.length) return;

  const needsHistory = rules.some(
    (r) => r.condition_type === "status_change" || r.condition_type === "consecutive_failures"
  );

  let recentHistory: { status: string }[] = [];
  if (needsHistory) {
    const { data } = await supabase
      .from("check_history")
      .select("status")
      .eq("config_id", configId)
      .order("checked_at", { ascending: false })
      .limit(10);
    recentHistory = data ?? [];
  }

  for (const rule of rules as AlertRuleRow[]) {
    if (!shouldTrigger(rule, newStatus, latencyMs, recentHistory)) continue;
    for (const channelId of rule.channel_ids) {
      await dispatchToChannel(supabase, rule, channelId, configId, configName, newStatus, latencyMs);
    }
  }
}

async function dispatchToChannel(
  supabase: ReturnType<typeof createAdminClient>,
  rule: AlertRuleRow,
  channelId: string,
  configId: string,
  configName: string,
  status: HealthStatus,
  latencyMs: number | null,
  strict = false
): Promise<void> {
  if (rule.cooldown_seconds > 0) {
    const cutoff = new Date(Date.now() - rule.cooldown_seconds * 1000).toISOString();
    const { data: recent, error: cooldownError } = await supabase
      .from("alert_history")
      .select("id")
      .eq("rule_id", rule.id)
      .eq("channel_id", channelId)
      .eq("config_id", configId)
      .eq("status", "sent")
      .gte("triggered_at", cutoff)
      .limit(1);

    if (strict && cooldownError) throw new Error(`读取告警冷却失败：${cooldownError.code}`);
    if (recent?.length) {
      await supabase.from("alert_history").insert({
        rule_id: rule.id, channel_id: channelId, config_id: configId,
        status: "skipped", error_message: "cooldown",
      });
      return;
    }
  }

  const { data: channelData, error: channelError } = await supabase
    .from("alert_channels")
    .select("*")
    .eq("id", channelId)
    .eq("enabled", true)
    .maybeSingle();

  if (strict && channelError) throw new Error(`读取告警渠道失败：${channelError.code}`);
  if (!channelData) return;
  const channel = channelData as AlertChannelRow;

  const title = `[Check CX] ${rule.name}`;
  const content = `配置：${configName}\n状态：${status}${latencyMs != null ? `\n延迟：${latencyMs}ms` : ""}`;
  const payload = { rule: rule.name, config_id: configId, config_name: configName, status, latency_ms: latencyMs };

  let sendError: string | null = null;
  try {
    if (channel.type === "webhook") {
      await sendWebhook(channel.config as { url: string; secret?: string }, payload);
    } else if (channel.type === "feishu") {
      await sendFeishu(channel.config as { url: string }, title, content);
    } else if (channel.type === "dingtalk") {
      await sendDingTalk(channel.config as { url: string }, title, content);
    } else if (channel.type === "pushplus") {
      await sendPushPlus(channel.config as { token: string }, title, content);
    }
  } catch (err) {
    sendError = err instanceof Error ? err.message : String(err);
    logError(`告警发送失败 channel=${channelId}`, err);
  }

  const {error: saveError} = await supabase.from("alert_history").insert({
    rule_id: rule.id,
    channel_id: channelId,
    config_id: configId,
    status: sendError ? "failed" : "sent",
    payload,
    error_message: sendError,
  });
  if (strict && saveError) throw new Error(`保存告警结果失败：${saveError.code}`);
  if (strict && sendError) throw new Error(sendError);
}
