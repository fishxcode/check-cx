INSERT INTO public.site_settings (key, value, description, editable, value_type) VALUES
  ('global_group_health.enabled', 'true', '是否在前台展示 New API 全局分组监控', true, 'boolean'),
  ('global_group_health.newapi_base_url', '', 'New API 服务地址，例如 https://api.example.com', true, 'string'),
  ('global_group_health.newapi_access_token', '', 'New API 系统访问令牌（私密密钥，留空则不修改）', true, 'secret'),
  ('global_group_health.newapi_user_id', '', 'New API 用户 ID；留空表示全局统计，不按用户过滤', true, 'number')
ON CONFLICT (key) DO NOTHING;

UPDATE public.site_settings
SET value = '', description = 'New API 用户 ID；留空表示全局统计，不按用户过滤'
WHERE key = 'global_group_health.newapi_user_id'
  AND value = '1';
