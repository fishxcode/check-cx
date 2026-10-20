import { SettingsClient } from "./client";

const SAFE_ENV_VARS = [
  { key: "CHECK_NODE_ID",                          label: "节点 ID",           description: "当前节点标识，多节点部署时用于选主" },
  { key: "CHECK_POLL_INTERVAL_SECONDS",            label: "旧轮询间隔",         description: "旧轮询模式的环境变量；队列检测间隔使用上方系统配置" },
  { key: "CHECK_CONCURRENCY",                      label: "旧轮询并发数",       description: "旧轮询模式的并发上限；Cloudflare 队列并发由 Worker 配置决定" },
  { key: "OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS", label: "官方状态轮询间隔",   description: "检查 OpenAI/Anthropic 官方状态的间隔（秒）" },
];

export default function SettingsPage() {
  const envVars = SAFE_ENV_VARS.map((v) => ({
    ...v,
    value: process.env[v.key] ?? "",
  }));

  return <SettingsClient envVars={envVars} />;
}
