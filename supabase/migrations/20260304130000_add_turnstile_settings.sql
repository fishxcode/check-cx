-- 添加 Cloudflare Turnstile 人机验证配置项
-- Site Key 为公开密钥（前端渲染），Secret Key 为私密密钥（服务端验证）
-- 两项均留空则不启用 Turnstile 验证
INSERT INTO public.site_settings (key, value, description, editable, value_type) VALUES
  ('cf.turnstile_site_key',   '', 'Cloudflare Turnstile Site Key（公开密钥，留空则不启用）',   true, 'string'),
  ('cf.turnstile_secret_key', '', 'Cloudflare Turnstile Secret Key（私密密钥，留空则不启用）', true, 'secret')
ON CONFLICT (key) DO NOTHING;
