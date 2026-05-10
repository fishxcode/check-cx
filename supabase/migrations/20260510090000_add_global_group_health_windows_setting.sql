INSERT INTO public.site_settings (key, value, description, editable, value_type) VALUES
  (
    'global_group_health.windows',
    '1h,6h,12h,24h,7d,15d,30d',
    '全局分组监控历史窗口，按逗号分隔，可选：1h,6h,12h,24h,7d,15d,30d',
    true,
    'string'
  )
ON CONFLICT (key) DO NOTHING;
