-- =============================================================================
-- 审计日志与配置调度增强功能迁移脚本
-- 创建时间: 2026-08-29
-- 功能模块:
--   1. 配置审计日志系统
--   2. 配置标签与锁定功能
--   3. 智能调度与暂停功能
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 第 1 部分: 扩展 check_configs 表
-- -----------------------------------------------------------------------------

-- 添加标签字段
ALTER TABLE public.check_configs
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

COMMENT ON COLUMN public.check_configs.tags IS '标签列表（数组），支持筛选和分类，如 [''生产'', ''高优先级'', ''备用'']';

-- 添加锁定相关字段
ALTER TABLE public.check_configs
  ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS locked_by UUID NULL,
  ADD COLUMN IF NOT EXISTS lock_reason TEXT NULL;

COMMENT ON COLUMN public.check_configs.locked IS '是否锁定（锁定后编辑/删除需要二次确认）';
COMMENT ON COLUMN public.check_configs.locked_at IS '锁定时间';
COMMENT ON COLUMN public.check_configs.locked_by IS '锁定者 ID（来自 auth.users）';
COMMENT ON COLUMN public.check_configs.lock_reason IS '锁定原因';

-- 添加智能调度相关字段
ALTER TABLE public.check_configs
  ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS check_interval_override INTEGER NULL,
  ADD COLUMN IF NOT EXISTS latency_threshold_ms INTEGER DEFAULT 6000,
  ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.check_configs.paused_until IS '临时暂停截止时间。当前时间 < paused_until 时跳过该配置的检查。NULL 表示未暂停';
COMMENT ON COLUMN public.check_configs.check_interval_override IS '自定义检查间隔（秒）。覆盖全局轮询间隔，支持 15-600 秒。NULL 表示使用全局配置';
COMMENT ON COLUMN public.check_configs.latency_threshold_ms IS '延迟阈值（毫秒）。超过此值标记为 degraded，否则为 operational。NULL 或未设置时使用全局默认值 6000ms';
COMMENT ON COLUMN public.check_configs.next_check_at IS '下次预定检查时间。轮询器仅执行 next_check_at <= now() 的配置。检查完成后自动更新为 now() + check_interval。由系统维护';

-- 添加标签 GIN 索引（支持数组查询）
CREATE INDEX IF NOT EXISTS idx_configs_tags ON public.check_configs USING GIN(tags);

-- 添加锁定状态索引（优化锁定配置查询）
CREATE INDEX IF NOT EXISTS idx_configs_locked ON public.check_configs(locked) WHERE locked = true;

-- 添加下次检查时间索引（优化轮询器查询）
CREATE INDEX IF NOT EXISTS idx_configs_next_check_at ON public.check_configs(next_check_at) WHERE next_check_at IS NOT NULL;

-- 添加暂停状态索引（优化暂停配置过滤）
CREATE INDEX IF NOT EXISTS idx_configs_paused_until ON public.check_configs(paused_until) WHERE paused_until IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 第 2 部分: 创建审计日志表
-- -----------------------------------------------------------------------------

-- 审计日志表：记录所有配置变更操作
CREATE TABLE IF NOT EXISTS public.config_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id       UUID NOT NULL REFERENCES public.check_configs(id) ON DELETE CASCADE,
  action          TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'enable', 'disable', 'lock', 'unlock', 'pause', 'resume')),
  actor_id        UUID NOT NULL,
  actor_email     TEXT NOT NULL,
  before_data     JSONB NULL,
  after_data      JSONB NULL,
  changed_fields  TEXT[] NULL,
  reason          TEXT NULL,
  ip_address      INET NULL,
  user_agent      TEXT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.config_audit_log IS '配置变更审计日志表，记录所有配置操作的完整历史';
COMMENT ON COLUMN public.config_audit_log.id IS '日志唯一标识';
COMMENT ON COLUMN public.config_audit_log.config_id IS '关联的配置 ID';
COMMENT ON COLUMN public.config_audit_log.action IS '操作类型: create, update, delete, enable, disable, lock, unlock, pause, resume';
COMMENT ON COLUMN public.config_audit_log.actor_id IS '操作者 ID（来自 auth.users）';
COMMENT ON COLUMN public.config_audit_log.actor_email IS '操作者邮箱（冗余存储，便于查询）';
COMMENT ON COLUMN public.config_audit_log.before_data IS '变更前的完整数据快照（JSON 格式，不含 api_key）';
COMMENT ON COLUMN public.config_audit_log.after_data IS '变更后的完整数据快照（JSON 格式，不含 api_key）';
COMMENT ON COLUMN public.config_audit_log.changed_fields IS '变更的字段列表（数组，如 [''name'', ''endpoint'']）';
COMMENT ON COLUMN public.config_audit_log.reason IS '变更原因（可选，由操作者填写）';
COMMENT ON COLUMN public.config_audit_log.ip_address IS '操作者 IP 地址';
COMMENT ON COLUMN public.config_audit_log.user_agent IS '操作者浏览器 User-Agent';
COMMENT ON COLUMN public.config_audit_log.created_at IS '操作时间';

-- 审计日志索引：按配置 ID 和时间查询
CREATE INDEX IF NOT EXISTS idx_audit_log_config_id ON public.config_audit_log(config_id, created_at DESC);

-- 审计日志索引：按操作者 ID 和时间查询
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON public.config_audit_log(actor_id, created_at DESC);

-- 审计日志索引：按操作类型和时间查询
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.config_audit_log(action, created_at DESC);

-- 审计日志索引：时间倒序索引（优化列表查询）
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.config_audit_log(created_at DESC);

-- -----------------------------------------------------------------------------
-- 第 3 部分: 审计日志 RLS 策略
-- -----------------------------------------------------------------------------

ALTER TABLE public.config_audit_log ENABLE ROW LEVEL SECURITY;

-- 策略：管理员可查看所有审计日志
CREATE POLICY "allow_authenticated_select_audit_log"
  ON public.config_audit_log
  FOR SELECT
  TO authenticated
  USING (true);

-- 策略：系统可插入审计日志（不限制）
CREATE POLICY "allow_system_insert_audit_log"
  ON public.config_audit_log
  FOR INSERT
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 第 4 部分: 错误建议库表（用于智能诊断功能）
-- -----------------------------------------------------------------------------

-- 错误修复建议库表
CREATE TABLE IF NOT EXISTS public.error_recommendations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category          TEXT NOT NULL CHECK (category IN ('network', 'auth', 'rate_limit', 'model', 'validation', 'unknown')),
  severity          TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  action_items      JSONB NOT NULL DEFAULT '[]',
  pattern_matchers  JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.error_recommendations IS '预定义的错误修复建议库，用于智能诊断模块';
COMMENT ON COLUMN public.error_recommendations.category IS '错误类别: network, auth, rate_limit, model, validation, unknown';
COMMENT ON COLUMN public.error_recommendations.severity IS '严重程度: critical, high, medium, low';
COMMENT ON COLUMN public.error_recommendations.title IS '建议标题';
COMMENT ON COLUMN public.error_recommendations.description IS '建议描述';
COMMENT ON COLUMN public.error_recommendations.action_items IS '行动项列表（JSONB 数组）';
COMMENT ON COLUMN public.error_recommendations.pattern_matchers IS '错误模式匹配规则（JSONB 数组，支持正则表达式）';

-- 错误模式聚合表
CREATE TABLE IF NOT EXISTS public.error_patterns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_hash          TEXT UNIQUE NOT NULL,
  pattern_text          TEXT NOT NULL,
  category              TEXT NOT NULL CHECK (category IN ('network', 'auth', 'rate_limit', 'model', 'validation', 'unknown')),
  count                 INTEGER DEFAULT 1,
  first_seen            TIMESTAMPTZ DEFAULT now(),
  last_seen             TIMESTAMPTZ DEFAULT now(),
  affected_config_ids   TEXT[] DEFAULT '{}',
  recommendation_id     UUID REFERENCES public.error_recommendations(id),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.error_patterns IS '错误模式聚合表，用于统计和分析历史错误';
COMMENT ON COLUMN public.error_patterns.pattern_hash IS '错误模式的唯一哈希值（用于去重）';
COMMENT ON COLUMN public.error_patterns.pattern_text IS '标准化后的错误消息文本';
COMMENT ON COLUMN public.error_patterns.category IS '错误类别';
COMMENT ON COLUMN public.error_patterns.count IS '出现次数';
COMMENT ON COLUMN public.error_patterns.first_seen IS '首次出现时间';
COMMENT ON COLUMN public.error_patterns.last_seen IS '最后出现时间';
COMMENT ON COLUMN public.error_patterns.affected_config_ids IS '受影响的配置 ID 列表';
COMMENT ON COLUMN public.error_patterns.recommendation_id IS '关联的修复建议 ID';

CREATE INDEX IF NOT EXISTS idx_error_patterns_category ON public.error_patterns(category);
CREATE INDEX IF NOT EXISTS idx_error_patterns_count ON public.error_patterns(count DESC);
CREATE INDEX IF NOT EXISTS idx_error_patterns_last_seen ON public.error_patterns(last_seen DESC);

-- 诊断结果表
CREATE TABLE IF NOT EXISTS public.diagnostic_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id           UUID NOT NULL REFERENCES public.check_configs(id) ON DELETE CASCADE,
  started_at          TIMESTAMPTZ NOT NULL,
  completed_at        TIMESTAMPTZ NOT NULL,
  total_duration_ms   INTEGER NOT NULL,
  layers              JSONB NOT NULL DEFAULT '{}',
  overall_status      TEXT NOT NULL CHECK (overall_status IN ('success', 'partial', 'failed')),
  recommendations     JSONB DEFAULT '[]',
  created_at          TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.diagnostic_results IS '诊断结果表，存储 5 层诊断的完整结果';
COMMENT ON COLUMN public.diagnostic_results.config_id IS '关联的配置 ID';
COMMENT ON COLUMN public.diagnostic_results.started_at IS '诊断开始时间';
COMMENT ON COLUMN public.diagnostic_results.completed_at IS '诊断完成时间';
COMMENT ON COLUMN public.diagnostic_results.total_duration_ms IS '总耗时（毫秒）';
COMMENT ON COLUMN public.diagnostic_results.layers IS '各层诊断结果（JSONB，包含 dns, tls, ttfb, api, validation）';
COMMENT ON COLUMN public.diagnostic_results.overall_status IS '整体诊断状态: success, partial, failed';
COMMENT ON COLUMN public.diagnostic_results.recommendations IS '诊断建议列表（JSONB 数组）';

CREATE INDEX IF NOT EXISTS idx_diagnostic_results_config_id ON public.diagnostic_results(config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diagnostic_results_created_at ON public.diagnostic_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diagnostic_results_overall_status ON public.diagnostic_results(overall_status, created_at DESC);

-- -----------------------------------------------------------------------------
-- 第 5 部分: 触发器 - 自动更新 updated_at
-- -----------------------------------------------------------------------------

CREATE TRIGGER update_error_recommendations_updated_at
  BEFORE UPDATE ON public.error_recommendations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_error_patterns_updated_at
  BEFORE UPDATE ON public.error_patterns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 第 6 部分: 预置错误修复建议数据
-- -----------------------------------------------------------------------------

INSERT INTO public.error_recommendations (category, severity, title, description, action_items, pattern_matchers) VALUES
  ('auth', 'critical', 'API 密钥无效', '检测到 401 认证失败错误，可能是 API 密钥已过期或被撤销',
   '["检查 Supabase check_configs 表中的 api_key 字段", "确认密钥未过期或被撤销", "联系 Provider 重新生成密钥"]'::jsonb,
   '["\\[401\\]", "Invalid API key", "authentication", "unauthorized"]'::jsonb),

  ('rate_limit', 'high', '速率限制触发', '检测到 429 速率限制错误，当前 API 配额不足',
   '["增加轮询间隔（CHECK_POLL_INTERVAL_SECONDS）", "升级 API 套餐", "分散请求到多个配置", "考虑使用自定义检查间隔（check_interval_override）"]'::jsonb,
   '["\\[429\\]", "Rate limit", "quota", "too many requests"]'::jsonb),

  ('network', 'critical', 'DNS 解析失败', 'DNS 解析失败，无法连接到目标端点',
   '["验证端点 URL 是否正确", "检查网络连接", "尝试更换 DNS 服务器", "确认域名未过期"]'::jsonb,
   '["DNS resolution failed", "ENOTFOUND", "getaddrinfo"]'::jsonb),

  ('network', 'high', '连接超时', '连接目标服务器超时，可能是网络不稳定或服务器响应慢',
   '["检查网络连接", "验证端点 URL 是否可访问", "增加超时阈值", "考虑使用 CDN 或加速服务"]'::jsonb,
   '["timeout", "ETIMEDOUT", "ECONNREFUSED"]'::jsonb),

  ('network', 'high', 'TLS 证书问题', 'TLS 握手失败或证书无效',
   '["检查证书是否过期", "验证证书链完整性", "更新证书", "检查是否存在中间人攻击"]'::jsonb,
   '["certificate", "TLS", "SSL", "CERT_"]'::jsonb),

  ('model', 'high', '模型不可用', '请求的模型不存在或暂时不可用',
   '["检查模型名称是否正确", "确认模型未被下线", "联系 Provider 确认模型状态", "考虑切换到备用模型"]'::jsonb,
   '["model not found", "model_not_found", "does not exist"]'::jsonb),

  ('validation', 'medium', '响应验证失败', '模型返回内容未通过数学挑战验证',
   '["检查模型是否正常工作", "确认端点未被劫持", "验证 API 响应格式", "考虑更换模型"]'::jsonb,
   '["validation_failed", "answer incorrect"]'::jsonb),

  ('unknown', 'medium', '未知错误', '发生未分类的错误',
   '["查看详细错误日志", "联系技术支持", "尝试重新配置", "检查 Provider 官方状态页"]'::jsonb,
   '[".*"]'::jsonb)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 第 7 部分: 辅助函数 - 获取配置的审计历史
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_config_audit_history(
  target_config_id UUID,
  limit_count INTEGER DEFAULT 50
)
RETURNS TABLE (
  id              UUID,
  action          TEXT,
  actor_email     TEXT,
  before_data     JSONB,
  after_data      JSONB,
  changed_fields  TEXT[],
  reason          TEXT,
  created_at      TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    action,
    actor_email,
    before_data,
    after_data,
    changed_fields,
    reason,
    created_at
  FROM public.config_audit_log
  WHERE config_id = target_config_id
  ORDER BY created_at DESC
  LIMIT limit_count;
$$;

COMMENT ON FUNCTION public.get_config_audit_history IS '获取指定配置的审计历史记录';

-- -----------------------------------------------------------------------------
-- 第 8 部分: 辅助函数 - 获取所有已使用的标签
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_all_tags()
RETURNS TABLE (tag TEXT, count BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT t.tag, COUNT(*) AS count
  FROM public.check_configs c
  CROSS JOIN LATERAL unnest(c.tags) AS t(tag)
  WHERE c.tags IS NOT NULL AND array_length(c.tags, 1) > 0
  GROUP BY t.tag
  ORDER BY count DESC, t.tag ASC;
$$;

COMMENT ON FUNCTION public.get_all_tags IS '获取所有已使用的标签及其使用次数';

-- -----------------------------------------------------------------------------
-- 完成
-- -----------------------------------------------------------------------------

-- 输出迁移完成信息
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '审计日志与配置调度增强功能迁移完成';
  RAISE NOTICE '========================================';
  RAISE NOTICE '已添加功能:';
  RAISE NOTICE '  1. 配置标签系统 (check_configs.tags)';
  RAISE NOTICE '  2. 配置锁定功能 (check_configs.locked)';
  RAISE NOTICE '  3. 智能调度功能 (check_configs.paused_until, check_interval_override)';
  RAISE NOTICE '  4. 审计日志表 (config_audit_log)';
  RAISE NOTICE '  5. 错误模式分析表 (error_patterns, error_recommendations)';
  RAISE NOTICE '  6. 诊断结果表 (diagnostic_results)';
  RAISE NOTICE '  7. 辅助函数 (get_config_audit_history, get_all_tags)';
  RAISE NOTICE '========================================';
END $$;
