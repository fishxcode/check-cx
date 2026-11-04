-- 提高批量测试的消费并发上限：dispatch_check_queue 每次领任务数从 20 提到 200，
-- 与 lib/core/check-queue.ts 的 getCheckQueueConcurrency() 硬上限（200）保持一致，
-- 避免调用方传入更大的 p_max_tasks 时被 SQL 的 least(20, …) 截断。

create or replace function public.dispatch_check_queue(
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
    limit least(200, greatest(1, coalesce(p_max_tasks, 8)))
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
