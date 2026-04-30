UPDATE public.site_settings
SET value = 'true'
WHERE key = 'global_group_health.enabled'
  AND value = 'false';
