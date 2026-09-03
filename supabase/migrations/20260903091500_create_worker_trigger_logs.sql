-- =============================================================================
-- Worker 触发日志表
-- 创建时间: 2026-09-03
-- 功能:
--   记录 Cloudflare Worker 定时触发（cron）与手动触发（fetch）的调用记录，
--   用于确认外部调度是否按预期到达服务端，以及检测执行耗时与结果。
--   写入方: /api/internal/checks/run (service-role, 不接受客户端直写)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.worker_trigger_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id      TEXT UNIQUE NOT NULL,          -- Worker 生成的触发尝试 ID
  trigger_type    TEXT NOT NULL DEFAULT 'worker',
  worker_event    TEXT NULL,                     -- CF Worker 事件类型: scheduled | fetch
  token_name      TEXT NULL,                     -- 使用哪个调度 Token（非 Worker 调用时）
  status          TEXT NOT NULL DEFAULT 'running',
  duration_ms     INTEGER NULL,                  -- 服务端检测执行耗时
  config_count    INTEGER NULL,                  -- 本轮检测的配置数量
  issue_count     INTEGER NULL,                  -- failed/validation_failed/error 数量
  message         TEXT NULL,
  triggered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.worker_trigger_logs IS '外部调度触发日志：记录 CF Worker Cron 每次触达服务端的调用';
COMMENT ON COLUMN public.worker_trigger_logs.attempt_id IS '调用方生成的尝试 ID，用于区分每次触发';
COMMENT ON COLUMN public.worker_trigger_logs.trigger_type IS '触发来源类型: worker | token';
COMMENT ON COLUMN public.worker_trigger_logs.worker_event IS 'CF Worker 事件类型: scheduled(cron) | fetch(手动)';
COMMENT ON COLUMN public.worker_trigger_logs.token_name IS '调度 Token 名称';
COMMENT ON COLUMN public.worker_trigger_logs.status IS '状态: running | success | failed | aborted';
COMMENT ON COLUMN public.worker_trigger_logs.duration_ms IS '检测执行耗时(ms)';
COMMENT ON COLUMN public.worker_trigger_logs.config_count IS '本轮检测配置数';
COMMENT ON COLUMN public.worker_trigger_logs.issue_count IS '异常配置数';
COMMENT ON COLUMN public.worker_trigger_logs.message IS '结果或错误信息';
COMMENT ON COLUMN public.worker_trigger_logs.triggered_at IS '触发时间（服务端收到请求时间）';
COMMENT ON COLUMN public.worker_trigger_logs.finished_at IS '检测完成时间';

-- 仅服务端 service-role 写入，启用 RLS 且不建策略，阻止客户端直读
ALTER TABLE public.worker_trigger_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_worker_trigger_logs_triggered_at
  ON public.worker_trigger_logs (triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_worker_trigger_logs_status
  ON public.worker_trigger_logs (status);
