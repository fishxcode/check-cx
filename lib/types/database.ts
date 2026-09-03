/**
 * 数据库表类型定义
 * 对应 Supabase 的 check_configs 和 check_history 表
 */

/**
 * check_configs 表的行类型
 */
export interface CheckConfigRow {
  id: string;
  name: string;
  type: string;
  model: string;
  endpoint: string;
  api_key: string;
  enabled: boolean;
  is_maintenance: boolean;
  request_header?: Record<string, string> | null;
  metadata?: Record<string, unknown> | null;
  group_name?: string | null;
  stream_mode?: "stream" | "generate" | null;
  tags?: string[] | null;
  locked?: boolean;
  locked_at?: string | null;
  locked_by?: string | null;
  lock_reason?: string | null;
  paused_until?: string | null;
  check_interval_override?: number | null;
  latency_threshold_ms?: number | null;
  next_check_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * check_history 表的行类型
 */
export interface CheckHistoryRow {
  id: string;
  config_id: string;
  status: string;
  latency_ms: number | null;
  ping_latency_ms: number | null;
  checked_at: string;
  message: string | null;
}

/**
 * availability_stats 视图的行类型
 */
export interface AvailabilityStats {
  config_id: string;
  period: "7d" | "15d" | "30d";
  total_checks: number;
  operational_count: number;
  availability_pct: number | null;
}

/**
 * group_info 表的行类型
 */
export interface GroupInfoRow {
  id: string;
  group_name: string;
  display_name?: string | null;
  description?: string | null;
  website_url?: string | null;
  icon_url?: string | null;
  tags?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * system_notifications 表的行类型
 */
export interface SystemNotificationRow {
  id: string;
  message: string;
  is_active: boolean;
  level: "info" | "warning" | "error";
  scope: "public" | "admin" | "both";
  start_time?: string | null;
  end_time?: string | null;
  created_at: string;
}

export interface SiteSettingRow {
  key: string;
  value: string | null;
  description: string | null;
  editable: boolean;
  value_type: "string" | "number" | "boolean";
}

export interface AlertChannelRow {
  id: string;
  name: string;
  type: "webhook" | "feishu" | "dingtalk" | "pushplus";
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

export interface AlertRuleRow {
  id: string;
  name: string;
  condition_type: "status_change" | "consecutive_failures" | "latency_threshold";
  condition_params: Record<string, unknown>;
  channel_ids: string[];
  config_ids: string[] | null;
  enabled: boolean;
  cooldown_seconds: number;
  created_at: string;
}

export interface AlertHistoryRow {
  id: string;
  rule_id: string;
  channel_id: string;
  config_id: string;
  status: "sent" | "failed" | "skipped";
  payload: Record<string, unknown> | null;
  error_message: string | null;
  triggered_at: string;
}

/** config_audit_log 表的行类型 */
export type AuditAction =
  | "create" | "update" | "delete"
  | "enable" | "disable"
  | "lock" | "unlock"
  | "pause" | "resume";

export interface ConfigAuditLogRow {
  id: string;
  config_id: string;
  action: AuditAction;
  actor_id: string;
  actor_email: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

/** error_recommendations 表的行类型 */
export type ErrorCategory =
  | "network" | "auth" | "rate_limit" | "model" | "validation" | "unknown";

export interface ErrorRecommendationRow {
  id: string;
  category: ErrorCategory;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  action_items: string[];
  pattern_matchers: string[];
  created_at: string;
  updated_at: string;
}

/** error_patterns 表的行类型 */
export interface ErrorPatternRow {
  id: string;
  pattern_hash: string;
  pattern_text: string;
  category: ErrorCategory;
  count: number;
  first_seen: string;
  last_seen: string;
  affected_config_ids: string[];
  recommendation_id: string | null;
  updated_at: string;
}

/** diagnostic_results 表的行类型 */
export interface DiagnosticResultRow {
  id: string;
  config_id: string;
  started_at: string;
  completed_at: string;
  total_duration_ms: number;
  layers: Record<string, unknown>;
  overall_status: "success" | "partial" | "failed";
  recommendations: unknown[];
  created_at: string;
}

/** worker_trigger_logs 表的行类型（外部调度触发日志） */
export type WorkerTriggerStatus = "running" | "success" | "failed" | "aborted";

export interface WorkerTriggerLogRow {
  id: string;
  attempt_id: string;
  trigger_type: "worker" | "token";
  worker_event: "scheduled" | "fetch" | null;
  token_name: string | null;
  status: WorkerTriggerStatus;
  duration_ms: number | null;
  config_count: number | null;
  issue_count: number | null;
  message: string | null;
  triggered_at: string;
  finished_at: string | null;
  created_at: string;
}
