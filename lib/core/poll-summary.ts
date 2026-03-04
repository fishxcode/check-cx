import "server-only";

import { createAdminClient } from "../supabase/admin";
import { getSiteSettingSync } from "./site-settings";
import { sendWebhook } from "../alerts/webhook";
import { sendFeishu } from "../alerts/feishu";
import { sendDingTalk } from "../alerts/dingtalk";
import { sendPushPlus } from "../alerts/pushplus";
import { logError } from "../utils";
import type { CheckResult } from "../types";
import type { AlertChannelRow } from "../types/database";

export async function sendPollSummary(results: CheckResult[]): Promise<void> {
  const raw = getSiteSettingSync("alert.summary_channel_ids", "");
  if (!raw) return;

  let channelIds: string[];
  try {
    channelIds = JSON.parse(raw);
    if (!Array.isArray(channelIds) || channelIds.length === 0) return;
  } catch {
    return;
  }

  const counts = { operational: 0, degraded: 0, failed: 0 };
  const abnormal: CheckResult[] = [];

  for (const r of results) {
    if (r.status === "operational") {
      counts.operational++;
    } else if (r.status === "degraded") {
      counts.degraded++;
      abnormal.push(r);
    } else {
      counts.failed++;
      abnormal.push(r);
    }
  }

  const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const title = "[Check CX] 本轮检测汇总";
  const lines = [
    `检测时间：${now}`,
    `总计 ${results.length} 个`,
    `✅ 正常 ${counts.operational}  ⚠️ 降级 ${counts.degraded}  ❌ 失败 ${counts.failed}`,
  ];

  if (abnormal.length > 0) {
    lines.push("", "异常详情：");
    for (const r of abnormal.slice(0, 10)) {
      const icon = r.status === "degraded" ? "⚠️" : "❌";
      const lat = r.latencyMs != null ? ` | ${r.latencyMs}ms` : "";
      lines.push(`${icon} ${r.name}${lat}`);
    }
  }

  const content = lines.join("\n");

  const { data } = await createAdminClient()
    .from("alert_channels")
    .select("*")
    .in("id", channelIds)
    .eq("enabled", true);

  for (const ch of data ?? []) {
    const channel = ch as AlertChannelRow;
    try {
      if (channel.type === "webhook") {
        await sendWebhook(channel.config as { url: string; secret?: string }, {
          type: "poll_summary",
          title,
          content,
          counts,
          abnormal: abnormal.map((r) => ({ name: r.name, status: r.status, latency_ms: r.latencyMs })),
        });
      } else if (channel.type === "feishu") {
        await sendFeishu(channel.config as { url: string }, title, content);
      } else if (channel.type === "dingtalk") {
        await sendDingTalk(channel.config as { url: string }, title, content);
      } else if (channel.type === "pushplus") {
        await sendPushPlus(channel.config as { token: string }, title, content.replace(/\n/g, "<br>"));
      }
    } catch (err) {
      logError(`汇总推送失败 channel=${channel.id}`, err);
    }
  }
}
