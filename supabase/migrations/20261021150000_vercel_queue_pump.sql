create table public.check_queue_pump_lease (
  singleton boolean primary key default true check (singleton),
  owner uuid,
  lease_until timestamptz not null default '-infinity'
);

insert into public.check_queue_pump_lease(singleton)
values (true) on conflict (singleton) do nothing;

alter table public.check_queue_pump_lease enable row level security;
revoke all on public.check_queue_pump_lease from public, anon, authenticated;
grant all on public.check_queue_pump_lease to service_role;

create function public.acquire_check_queue_pump_lease(p_owner uuid, p_seconds integer default 70)
returns boolean language sql security invoker set search_path = '' as $$
  with acquired as (
    insert into public.check_queue_pump_lease(singleton, owner, lease_until)
    values (true, p_owner, clock_timestamp() + make_interval(secs => least(greatest(p_seconds, 10), 120)))
    on conflict (singleton) do update
      set owner = excluded.owner, lease_until = excluded.lease_until
      where public.check_queue_pump_lease.lease_until <= clock_timestamp()
    returning true
  )
  select exists(select 1 from acquired);
$$;

create function public.release_check_queue_pump_lease(p_owner uuid)
returns void language sql security invoker set search_path = '' as $$
  update public.check_queue_pump_lease
  set owner = null, lease_until = '-infinity'
  where singleton and owner = p_owner;
$$;

drop function if exists public.dispatch_check_queue(text, text, integer);

create function public.dispatch_check_queue(
  p_attempt_id text,
  p_event text default 'scheduled',
  p_interval_seconds integer default 1800,
  p_max_tasks integer default 8
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_run_id uuid;
  v_ids jsonb;
  v_raw text;
  v_interval integer := 1800;
  v_now timestamptz;
  v_attempt text;
  v_latest timestamptz;
begin
  perform pg_advisory_xact_lock(20261021, 1);
  v_now := clock_timestamp();
  select value into v_raw from public.site_settings where key='check_poll_interval_seconds';
  if v_raw ~ '^[0-9]{1,4}$' and v_raw::integer between 60 and 3600 then
    v_interval := v_raw::integer;
  end if;
  v_attempt := 'queue:' || v_interval || ':' || floor(extract(epoch from v_now) / v_interval)::bigint;
  select max(created_at) into v_latest from public.check_queue_runs;

  if (v_latest is null or v_latest + make_interval(secs => v_interval) <= v_now)
    and not exists(select 1 from public.check_queue_runs where attempt_id=v_attempt)
    and not exists(select 1 from public.check_queue_runs where status='running') then
    insert into public.check_queue_runs(attempt_id, interval_seconds, created_at)
      values(v_attempt, v_interval, v_now) returning id into v_run_id;
    insert into public.worker_trigger_logs(attempt_id, trigger_type, worker_event, status)
      values(v_attempt, 'worker', p_event, 'running') on conflict do nothing;
    insert into public.check_queue_tasks(run_id, task_key, kind, config_id)
      select v_run_id, 'check:' || c.id, 'check', c.id
      from public.check_configs c
      where c.enabled and not coalesce(c.sync_disabled, false) and not c.is_maintenance
        and (c.paused_until is null or c.paused_until <= v_now);
    update public.check_queue_runs set config_count=(
      select count(*) from public.check_queue_tasks t where t.run_id=v_run_id
    ) where id=v_run_id;
    if not exists(select 1 from public.check_queue_tasks t where t.run_id=v_run_id) then
      update public.check_queue_runs set status='success', finished_at=v_now where id=v_run_id;
      update public.worker_trigger_logs set status='success', config_count=0, issue_count=0,
        finished_at=v_now, message='没有待检测配置' where attempt_id=v_attempt;
      insert into public.check_queue_tasks(run_id, task_key, kind)
        values(v_run_id, 'finish', 'finish');
    end if;
  end if;

  with ready as (
    select id from public.check_queue_tasks
    where ((status='pending' and available_at <= v_now)
        or (status='running' and lease_until <= v_now))
      and (dispatched_at is null or dispatched_at < v_now - interval '3 minutes' or kind <> 'check')
    order by available_at, id
    limit least(20, greatest(1, coalesce(p_max_tasks, 8)))
    for update skip locked
  ), dispatched as (
    update public.check_queue_tasks set dispatched_at=v_now
    where id in (select id from ready)
    returning id
  )
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids from dispatched;

  return jsonb_build_object(
    'tasks', v_ids,
    'queuedCount', jsonb_array_length(v_ids),
    'attemptId', v_attempt,
    'intervalSeconds', v_interval
  );
end;
$$;

create function public.dispatch_manual_check_queue(p_ids uuid[] default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_run_id uuid;
  v_attempt text;
  v_interval integer := 1800;
  v_raw text;
  v_count integer;
  v_active uuid;
begin
  perform pg_advisory_xact_lock(20261021, 1);

  select id into v_active from public.check_queue_runs where status='running' limit 1;
  if v_active is not null then
    raise exception using errcode='55P03', message='已有检测轮次正在运行，请稍后发起手动检测';
  end if;

  if p_ids is not null and cardinality(p_ids)=0 then
    raise exception 'ids 不能为空数组';
  end if;
  select value into v_raw from public.site_settings where key='check_poll_interval_seconds';
  if v_raw ~ '^[0-9]{1,4}$' and v_raw::integer between 60 and 3600 then
    v_interval := v_raw::integer;
  end if;
  v_attempt := 'manual:' || gen_random_uuid()::text;
  insert into public.check_queue_runs(attempt_id, interval_seconds)
    values(v_attempt, v_interval) returning id into v_run_id;
  insert into public.worker_trigger_logs(attempt_id, trigger_type, worker_event, status, token_name)
    values(v_attempt, 'token', 'fetch', 'running', 'manual-admin') on conflict do nothing;

  insert into public.check_queue_tasks(run_id, task_key, kind, config_id, payload)
  select v_run_id, 'check:' || c.id, 'check', c.id,
    case when p_ids is null then '{}'::jsonb else '{"manual":true}'::jsonb end
  from public.check_configs c
  where (p_ids is null and c.enabled and not coalesce(c.sync_disabled, false)
      and not c.is_maintenance and (c.paused_until is null or c.paused_until <= clock_timestamp()))
    or (p_ids is not null and c.id = any(p_ids));
  get diagnostics v_count = row_count;

  if p_ids is not null and v_count <> cardinality(p_ids) then
    raise exception '部分配置不存在';
  end if;

  update public.check_queue_runs set config_count=v_count where id=v_run_id;
  if v_count=0 then
    update public.check_queue_runs set status='success', finished_at=clock_timestamp() where id=v_run_id;
    update public.worker_trigger_logs set status='success', config_count=0, issue_count=0,
      finished_at=clock_timestamp(), message='没有可检测配置' where attempt_id=v_attempt;
    insert into public.check_queue_tasks(run_id, task_key, kind)
      values(v_run_id, 'finish', 'finish');
  end if;

  return jsonb_build_object('runId', v_run_id, 'attemptId', v_attempt,
    'queuedCount', v_count, 'reusedRun', false);
end;
$$;

revoke all on function public.acquire_check_queue_pump_lease(uuid, integer),
  public.release_check_queue_pump_lease(uuid), public.dispatch_manual_check_queue(uuid[]),
  public.dispatch_check_queue(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_check_queue_pump_lease(uuid, integer),
  public.release_check_queue_pump_lease(uuid), public.dispatch_manual_check_queue(uuid[]),
  public.dispatch_check_queue(text, text, integer, integer)
  to service_role;
