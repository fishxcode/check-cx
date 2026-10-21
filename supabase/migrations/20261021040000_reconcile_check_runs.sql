-- 管理员修复遗留日志；真实队列轮次必须明确选择中断，不按时长推断失败。
alter table public.check_queue_runs drop constraint if exists check_queue_runs_status_check;
alter table public.check_queue_runs add constraint check_queue_runs_status_check
  check (status in ('running','success','failed','aborted'));

create or replace function public.manage_check_trigger(p_log_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '3s' set statement_timeout = '8s' as $$
declare
  target public.worker_trigger_logs%rowtype;
  run public.check_queue_runs%rowtype;
  changed integer := 0;
  stopped integer := 0;
begin
  -- 调度先持此锁再写任务；沿用顺序避免与新建轮次交叉等待。
  perform pg_advisory_xact_lock(20261021,1);
  -- 短暂阻止领取/完成事务，等待既有事务结束后再终止任务，避免遗漏并发子任务。
  -- 普通查询仍可读取；网络中的外部请求不占此事务锁。
  lock table public.check_queue_tasks in exclusive mode;
  if p_log_id is not null then
    select * into target from public.worker_trigger_logs where id=p_log_id;
    if not found then return jsonb_build_object('error','日志不存在','code','not_found'); end if;
    if target.status <> 'running' then
      return jsonb_build_object('changed',0,'message','日志已结束，无需处理');
    end if;
    select * into run from public.check_queue_runs where attempt_id=target.attempt_id for update;
    if run.id is null then
      if target.triggered_at > now()-interval '24 hours' then
        return jsonb_build_object('error','无队列轮次的近期日志不能安全中断，请等待超过 24 小时后关闭','code','conflict');
      end if;
    elsif run.status='running' then
      update public.check_queue_tasks set status='failed', owner=null, lease_until=null,
        completed_at=now(), last_error='管理员中断本轮；未执行任务不再重试'
        where run_id=run.id and status in ('pending','running');
      get diagnostics stopped = row_count;
      update public.check_queue_runs set status='aborted', finished_at=now(),
        completed_count=config_count,
        error_count=error_count+(select count(*) from public.check_queue_tasks
          where run_id=run.id and kind='check' and last_error='管理员中断本轮；未执行任务不再重试')
        where id=run.id returning * into run;
    end if;
    update public.worker_trigger_logs set status=coalesce(run.status,'aborted'),
      finished_at=coalesce(run.finished_at,now()),
      duration_ms=case when run.id is null then null else
        greatest(0,least(2147483647,extract(epoch from (coalesce(run.finished_at,now())-run.created_at))*1000))::integer end,
      config_count=case when run.id is null then config_count else run.checked_count end,
      issue_count=case when run.id is null then issue_count else run.issue_count+run.error_count end,
      message=case when run.id is null then '管理员关闭超过 24 小时、无关联队列的遗留日志；不代表强制取消外部请求'
        when run.status='aborted' then format('管理员中断本轮，停止 %s 个未完成任务；已发出的请求可能仍在结束中',stopped)
        else '已依据关联队列轮次修复日志状态' end
      where id=p_log_id and status='running';
    get diagnostics changed = row_count;
  else
    -- 终态轮次日志按真实结果修复；不存在轮次的旧日志只标记人工关闭。
    update public.worker_trigger_logs l set status=r.status, finished_at=r.finished_at,
      duration_ms=case when r.finished_at is null then null else
        greatest(0,least(2147483647,extract(epoch from (r.finished_at-r.created_at))*1000))::integer end,
      config_count=r.checked_count, issue_count=r.issue_count+r.error_count,
      message='已依据关联队列轮次修复日志状态'
      from public.check_queue_runs r
      where l.attempt_id=r.attempt_id and l.status='running' and r.status<>'running';
    get diagnostics changed = row_count;
    update public.worker_trigger_logs l set status='aborted', finished_at=now(),
      message='管理员关闭超过 24 小时、无关联队列的遗留日志；不代表强制取消外部请求'
      where l.status='running' and l.triggered_at<=now()-interval '24 hours'
        and not exists(select 1 from public.check_queue_runs r where r.attempt_id=l.attempt_id);
    get diagnostics stopped = row_count;
    changed := changed+stopped;
    stopped := 0;
  end if;
  return jsonb_build_object('changed',changed,'stoppedTasks',stopped);
end;
$$;
revoke all on function public.manage_check_trigger(uuid) from public,anon,authenticated;
grant execute on function public.manage_check_trigger(uuid) to service_role;
