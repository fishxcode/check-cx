-- 保存探测当时的归属；旧记录只能采用迁移时配置归属。
alter table public.check_history
  add column if not exists model_snapshot text,
  add column if not exists group_snapshot text,
  add column if not exists attribution_source text;

update public.check_history h
set model_snapshot = c.model, group_snapshot = c.group_name,
    attribution_source = 'migration_current'
from public.check_configs c
where h.config_id = c.id and h.attribution_source is null;

create or replace function public.capture_monitoring_scope()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.attribution_source is distinct from 'recorded' then
    select model, group_name into new.model_snapshot, new.group_snapshot
    from public.check_configs where id = new.config_id;
    new.attribution_source := 'insert_current';
  end if;
  return new;
end;
$$;
drop trigger if exists capture_monitoring_scope on public.check_history;
create trigger capture_monitoring_scope before insert on public.check_history
for each row execute function public.capture_monitoring_scope();

create index if not exists check_history_monitoring_window_idx
  on public.check_history (checked_at desc);

-- 厂家映射由服务端从已配置及有历史的模型构造；当前厂家归属不代表历史厂家归属。
-- JSON 返回避免 PostgREST 行数限制截断统计。
create or replace function public.get_monitoring_statistics(p_vendors jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
with clock as (select now() as as_of),
windows(period, duration, bucket_seconds) as (
  values ('24h', interval '24 hours', 3600), ('7d', interval '7 days', 21600),
         ('15d', interval '15 days', 43200), ('30d', interval '30 days', 86400)
), samples as materialized (
  select h.* from public.check_history h, clock
  where h.checked_at >= clock.as_of - interval '30 days' and h.checked_at <= clock.as_of
    and h.status in ('operational','degraded','failed','error','validation_failed')
), expanded as (
  select h.*, s.scope_type, s.scope_key, w.period,
    to_timestamp(floor(extract(epoch from h.checked_at) / w.bucket_seconds) * w.bucket_seconds) as bucket
  from samples h cross join clock cross join windows w
  cross join lateral (values
    ('all', 'all'), ('config', h.config_id::text),
    ('model', h.model_snapshot), ('group', coalesce(nullif(h.group_snapshot,''), '__ungrouped__')),
    ('vendor', coalesce(p_vendors->>h.model_snapshot, 'other'))
  ) s(scope_type, scope_key)
  where h.checked_at >= clock.as_of - w.duration and s.scope_key is not null
), totals as (
  select scope_type, scope_key, period, count(*) as total,
    count(*) filter (where status in ('operational','degraded')) as success,
    count(*) filter (where status = 'operational') as operational,
    count(latency_ms) filter (where status in ('operational','degraded') and latency_ms >= 0) as latency_count,
    avg(latency_ms) filter (where status in ('operational','degraded') and latency_ms >= 0) as mean_latency,
    percentile_cont(0.95) within group (order by latency_ms) filter (where status in ('operational','degraded') and latency_ms >= 0) as p95_latency,
    min(checked_at) as first_at, max(checked_at) as last_at,
    count(*) filter (where attribution_source is distinct from 'recorded') as inferred
  from expanded group by scope_type, scope_key, period
), buckets as (
  select scope_type, scope_key, period, bucket,
    count(*) as total, count(*) filter (where status in ('operational','degraded')) as success,
    avg(latency_ms) filter (where status in ('operational','degraded') and latency_ms >= 0) as latency
  from expanded where scope_type <> 'config' group by scope_type, scope_key, period, bucket
), trends as (
  select scope_type, scope_key, period,
    jsonb_agg(jsonb_build_object('at', bucket, 'totalChecks', total,
      'availabilityPct', 100.0 * success / total, 'meanLatencyMs', latency) order by bucket) as points
  from buckets group by scope_type, scope_key, period
)
select jsonb_build_object('asOf', (select as_of from clock), 'stats', coalesce(jsonb_agg(
  jsonb_build_object('scopeType', t.scope_type, 'scopeKey', t.scope_key, 'period', t.period,
    'totalChecks', t.total, 'successCount', t.success, 'operationalCount', t.operational,
    'availabilityPct', 100.0 * t.success / t.total, 'attainmentPct', 100.0 * t.operational / t.total,
    'latencySampleCount', t.latency_count, 'meanLatencyMs', t.mean_latency, 'p95LatencyMs', t.p95_latency,
    'firstSampleAt', t.first_at, 'lastSampleAt', t.last_at, 'inferredAttributionCount', t.inferred,
    'trend', coalesce(r.points, '[]'::jsonb))), '[]'::jsonb))
from totals t left join trends r using(scope_type, scope_key, period);
$$;
revoke all on function public.get_monitoring_statistics(jsonb) from public, anon, authenticated;
grant execute on function public.get_monitoring_statistics(jsonb) to service_role;

-- 使用 JSON 标量避免模型清单受到 REST 返回行数限制。
create or replace function public.get_monitoring_model_names()
returns jsonb language sql stable security invoker set search_path = '' as $$
select coalesce(jsonb_agg(model),'[]'::jsonb) from (
  select model from public.check_configs
  union
  select model_snapshot from public.check_history where checked_at >= now() - interval '30 days' and model_snapshot is not null
) models;
$$;
revoke all on function public.get_monitoring_model_names() from public,anon,authenticated;
grant execute on function public.get_monitoring_model_names() to service_role;

-- 自动清理至少保留完整的三十天统计窗口，手动清空仍由管理接口处理。
create or replace function public.prune_check_history(retention_days integer default null, limit_per_config integer default null)
returns integer language plpgsql security invoker set search_path = '' as $$
declare deleted_count integer;
begin
  delete from public.check_history where checked_at < now() - make_interval(days => least(365,greatest(30,coalesce(retention_days,limit_per_config,30))));
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
