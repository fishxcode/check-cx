-- 修复维护中配置的可用性统计展示
-- 问题：维护中配置(is_maintenance=true)停止检查后，统计中看不到维护前的历史数据
-- 解决：在可用性统计视图中包含所有配置（包括维护中的），以便前端能展示维护前的统计数据

CREATE OR REPLACE VIEW public.availability_stats AS
SELECT
    h.config_id,
    '7d'::text AS period,
    COUNT(*) AS total_checks,
    COUNT(*) FILTER (WHERE h.status = 'operational') AS operational_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE h.status = 'operational') / NULLIF(COUNT(*), 0), 2) AS availability_pct
FROM public.check_history h
WHERE h.checked_at > NOW() - INTERVAL '7 days'
GROUP BY h.config_id

UNION ALL

SELECT
    h.config_id,
    '15d'::text AS period,
    COUNT(*) AS total_checks,
    COUNT(*) FILTER (WHERE h.status = 'operational') AS operational_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE h.status = 'operational') / NULLIF(COUNT(*), 0), 2) AS availability_pct
FROM public.check_history h
WHERE h.checked_at > NOW() - INTERVAL '15 days'
GROUP BY h.config_id

UNION ALL

SELECT
    h.config_id,
    '30d'::text AS period,
    COUNT(*) AS total_checks,
    COUNT(*) FILTER (WHERE h.status = 'operational') AS operational_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE h.status = 'operational') / NULLIF(COUNT(*), 0), 2) AS availability_pct
FROM public.check_history h
WHERE h.checked_at > NOW() - INTERVAL '30 days'
GROUP BY h.config_id;

COMMENT ON VIEW public.availability_stats IS '可用性统计视图，提供 7天/15天/30天 的可用性百分比（包括维护中配置的历史数据）';
