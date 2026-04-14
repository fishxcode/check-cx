INSERT INTO public.site_settings (key, value, description, editable, value_type) VALUES
  ('site.url', '', '站点完整 URL，用于 canonical / sitemap / robots / RSS，如 https://status.example.com', true, 'string'),
  ('site.keywords', 'AI 状态监控, OpenAI 状态, Gemini 状态, Anthropic 状态, API uptime, status page', '页面 meta keywords，逗号分隔', true, 'string')
ON CONFLICT (key) DO NOTHING;

