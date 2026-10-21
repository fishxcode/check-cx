-- 全站共享一次精确聚合，避免每个 Worker 实例、访客重复扫描完整历史。
alter function public.get_monitoring_statistics(jsonb) rename to get_monitoring_statistics_raw;
create table public.monitoring_statistics_cache (
  cache_key text primary key,
  vendors jsonb not null,
  value jsonb not null,
  computed_at timestamptz not null
);
alter table public.monitoring_statistics_cache enable row level security;
revoke all on public.monitoring_statistics_cache from public,anon,authenticated;
grant all on public.monitoring_statistics_cache to service_role;
create function public.get_monitoring_statistics(p_vendors jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  mapping jsonb := coalesce(p_vendors,'{}'::jsonb);
  key text;
  snapshot jsonb;
  computed timestamptz;
begin
  if jsonb_typeof(mapping)<>'object' then raise exception '无效厂家映射'; end if;
  key := md5(mapping::text);
  select c.value,c.computed_at into snapshot,computed from public.monitoring_statistics_cache c
    where c.cache_key=key and c.vendors=mapping;
  if computed>clock_timestamp()-interval '60 seconds' then return snapshot; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('monitoring:'||key,0)) then
    -- 已有刷新时保留原 asOf，有限陈旧结果不能伪装成新计算的统计。
    if computed>clock_timestamp()-interval '2 minutes' then return snapshot; end if;
    perform pg_advisory_xact_lock(hashtextextended('monitoring:'||key,0));
  end if;
  select c.value,c.computed_at into snapshot,computed from public.monitoring_statistics_cache c
    where c.cache_key=key and c.vendors=mapping;
  if computed>clock_timestamp()-interval '60 seconds' then return snapshot; end if;
  snapshot := public.get_monitoring_statistics_raw(mapping);
  insert into public.monitoring_statistics_cache(cache_key,vendors,value,computed_at)
    values(key,mapping,snapshot,clock_timestamp()) on conflict(cache_key) do update
      set vendors=excluded.vendors,value=excluded.value,computed_at=excluded.computed_at;
  delete from public.monitoring_statistics_cache where computed_at<clock_timestamp()-interval '1 day';
  return snapshot;
end;
$$;
revoke all on function public.get_monitoring_statistics(jsonb),public.get_monitoring_statistics_raw(jsonb)
  from public,anon,authenticated;
grant execute on function public.get_monitoring_statistics(jsonb),public.get_monitoring_statistics_raw(jsonb) to service_role;
