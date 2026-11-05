-- 调度心跳记录：区分「Token 失效」「Worker 没跑」「pump 执行失败」三种静默故障。
create table if not exists public.pump_heartbeats (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default clock_timestamp(),
  ok boolean not null,
  http_status integer not null,
  duration_ms integer,
  message text
);

create index if not exists pump_heartbeats_created_at_idx
  on public.pump_heartbeats (created_at desc);

alter table public.pump_heartbeats enable row level security;
revoke all on public.pump_heartbeats from public, anon, authenticated;
grant select, insert, delete on public.pump_heartbeats to service_role;
grant usage, select on sequence public.pump_heartbeats_id_seq to service_role;

create function public.record_pump_heartbeat(
  p_ok boolean,
  p_http_status integer,
  p_duration_ms integer default null,
  p_message text default null
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.pump_heartbeats(ok, http_status, duration_ms, message)
    values (p_ok, p_http_status, p_duration_ms, left(p_message, 500));
  -- 心跳每 5 分钟一条，保留 7 天足够排查，避免表无限增长。
  delete from public.pump_heartbeats
  where created_at < clock_timestamp() - interval '7 days';
end;
$$;

revoke all on function public.record_pump_heartbeat(boolean, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_pump_heartbeat(boolean, integer, integer, text)
  to service_role;
