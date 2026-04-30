INSERT INTO public.site_settings (key, value, description, editable, value_type) VALUES
  ('global_group_health.show_error_reasons', 'false', '是否展示全局分组监控的主要错误详情和复制按钮', true, 'boolean')
ON CONFLICT (key) DO NOTHING;
