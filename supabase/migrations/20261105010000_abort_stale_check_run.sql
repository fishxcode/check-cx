-- 自动终止长期停滞的检测轮次：
-- 轮次运行超过 p_max_age_seconds（默认 1 小时），且最近 p_stale_seconds（默认 30 分钟）
-- 没有任何 check 任务完成，则判定为停滞，停止剩余任务并标记 aborted。
create or replace function public.abort_stale_check_run(
  p_max_age_seconds integer default 3600,
  p_stale_seconds integer default 1800
) returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '3s' set statement_timeout = '8s' as $$
declare
  v_run_id uuid;
  v_attempt text;
  v_config_count integer;
  v_checked integer;
  v_issue integer;
  v_error integer;
  v_created timestamptz;
  v_stopped integer := 0;
begin
  -- 与 dispatch/管理中断保持同一把锁，避免在领取任务时交叉操作。
  perform pg_advisory_xact_lock(20261021, 1);
  lock table public.check_queue_tasks in exclusive mode;

  select r.id into v_run_id
  from public.check_queue_runs r
  where r.status = 'running'
    and r.created_at < clock_timestamp() - make_interval(secs => greatest(p_max_age_seconds, 60))
    and not exists (
      select 1 from public.check_queue_tasks t
      where t.run_id = r.id
        and t.kind = 'check'
        and t.completed_at is not null
        and t.completed_at > clock_timestamp() - make_interval(secs => greatest(p_stale_seconds, 60))
    )
  order by r.created_at
  limit 1;

  if v_run_id is null then
    return jsonb_build_object('aborted', false);
  end if;

  select attempt_id, config_count, checked_count, issue_count, error_count, created_at
    into v_attempt, v_config_count, v_checked, v_issue, v_error, v_created
  from public.check_queue_runs where id = v_run_id;

  update public.check_queue_tasks
  set status = 'failed', owner = null, lease_until = null,
      completed_at = clock_timestamp(),
      last_error = '自动终止：轮次超过时限且长时间无进展'
  where run_id = v_run_id and status in ('pending', 'running');
  get diagnostics v_stopped = row_count;

  update public.check_queue_runs
  set status = 'aborted', finished_at = clock_timestamp(),
      completed_count = config_count,
      error_count = error_count + v_stopped
  where id = v_run_id;

  update public.worker_trigger_logs
  set status = 'aborted', finished_at = clock_timestamp(),
      duration_ms = greatest(0, least(2147483647,
        extract(epoch from (clock_timestamp() - v_created)) * 1000))::integer,
      config_count = v_checked,
      issue_count = v_issue + v_error + v_stopped,
      message = format('自动终止：轮次运行超过 %s 秒且最近 %s 秒无任务完成，停止 %s 个未完成任务',
        p_max_age_seconds, p_stale_seconds, v_stopped)
  where attempt_id = v_attempt and status = 'running';

  return jsonb_build_object('aborted', true, 'attemptId', v_attempt, 'stopped', v_stopped);
end;
$$;

revoke all on function public.abort_stale_check_run(integer, integer)
  from public, anon, authenticated;
grant execute on function public.abort_stale_check_run(integer, integer)
  to service_role;
