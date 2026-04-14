-- 首页分组排序（管理员拖拽后全局生效）
INSERT INTO public.site_settings (key, value, description, editable, value_type)
VALUES (
  'dashboard.group_order',
  NULL,
  '首页分组自定义排序（JSON 数组，存 group_name 列表）',
  false,
  'json'
)
ON CONFLICT (key) DO NOTHING;

