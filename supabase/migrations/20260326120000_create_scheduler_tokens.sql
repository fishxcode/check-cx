CREATE TABLE IF NOT EXISTS public.scheduler_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  scope text NOT NULL DEFAULT 'checks:run',
  enabled boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.scheduler_tokens IS '外部调度调用专用 API Token 表';
COMMENT ON COLUMN public.scheduler_tokens.name IS 'Token 名称，用于区分调用方';
COMMENT ON COLUMN public.scheduler_tokens.token_hash IS 'Token 的 SHA-256 哈希，不存储明文';
COMMENT ON COLUMN public.scheduler_tokens.token_prefix IS 'Token 前缀，用于后台识别';
COMMENT ON COLUMN public.scheduler_tokens.scope IS 'Token 权限范围，当前固定 checks:run';
COMMENT ON COLUMN public.scheduler_tokens.enabled IS '是否启用';
COMMENT ON COLUMN public.scheduler_tokens.last_used_at IS '最近使用时间';
COMMENT ON COLUMN public.scheduler_tokens.expires_at IS '过期时间，为空表示不过期';

ALTER TABLE public.scheduler_tokens ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_scheduler_tokens_enabled
  ON public.scheduler_tokens (enabled, created_at DESC);

DROP TRIGGER IF EXISTS update_scheduler_tokens_updated_at ON public.scheduler_tokens;

CREATE TRIGGER update_scheduler_tokens_updated_at
  BEFORE UPDATE ON public.scheduler_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
