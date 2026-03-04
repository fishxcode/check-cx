import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "../../../_auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWebhook } from "@/lib/alerts/webhook";
import { sendFeishu } from "@/lib/alerts/feishu";
import { sendDingTalk } from "@/lib/alerts/dingtalk";
import { sendPushPlus } from "@/lib/alerts/pushplus";
import type { AlertChannelRow, AlertRuleRow } from "@/lib/types/database";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_: NextRequest, { params }: Ctx) {
  const err = await requireAuth();
  if (err) return err;

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: ruleData } = await supabase
    .from("alert_rules")
    .select("*")
    .eq("id", id)
    .single();

  if (!ruleData) return NextResponse.json({ error: "规则不存在" }, { status: 404 });
  const rule = ruleData as AlertRuleRow;

  if (!rule.channel_ids.length) {
    return NextResponse.json({ error: "该规则未配置任何渠道" }, { status: 400 });
  }

  const { data: channels } = await supabase
    .from("alert_channels")
    .select("*")
    .in("id", rule.channel_ids);

  const title = `[Check CX] 规则测试：${rule.name}`;
  const content = `这是来自规则「${rule.name}」的测试通知，渠道链路验证正常。`;

  const results: Array<{ name: string; ok: boolean; error?: string }> = [];

  for (const ch of channels ?? []) {
    const channel = ch as AlertChannelRow;
    try {
      if (channel.type === "webhook") {
        await sendWebhook(channel.config as { url: string; secret?: string }, { type: "test", title, content });
      } else if (channel.type === "feishu") {
        await sendFeishu(channel.config as { url: string }, title, content);
      } else if (channel.type === "dingtalk") {
        await sendDingTalk(channel.config as { url: string }, title, content);
      } else if (channel.type === "pushplus") {
        await sendPushPlus(channel.config as { token: string }, title, content);
      }
      results.push({ name: channel.name, ok: true });
    } catch (e) {
      results.push({ name: channel.name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 });
}
