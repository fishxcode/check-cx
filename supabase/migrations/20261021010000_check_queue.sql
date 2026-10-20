-- 前置：monitoring_statistics 与 add_upstream_sync 迁移。
-- 队列消息仅保存任务 ID；密钥始终从配置表读取。
create table public.check_queue_runs (
  id uuid primary key default gen_random_uuid(),
  attempt_id text not null unique,
  status text not null default 'running' check (status in ('running','success','failed')),
  config_count integer not null default 0,
  completed_count integer not null default 0,
  checked_count integer not null default 0,
  issue_count integer not null default 0,
  error_count integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create table public.check_queue_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.check_queue_runs(id) on delete cascade,
  task_key text not null,
  parent_id uuid,
  kind text not null check (kind in ('check','alerts','alert','finish','summary','official','prune')),
  config_id uuid,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  owner uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  dispatched_at timestamptz,
  last_error text,
  completed_at timestamptz,
  unique(run_id,task_key)
);
create index check_queue_tasks_ready_idx on public.check_queue_tasks(available_at,dispatched_at)
  where status in ('pending','running');
create index check_queue_tasks_parent_idx on public.check_queue_tasks(parent_id);
create index check_queue_runs_running_idx on public.check_queue_runs(created_at) where status = 'running';
alter table public.check_history add column queue_task_id uuid;
create unique index check_history_queue_task_idx on public.check_history(queue_task_id)
  where queue_task_id is not null;
alter table public.check_queue_runs enable row level security;
alter table public.check_queue_tasks enable row level security;
revoke all on public.check_queue_runs,public.check_queue_tasks from public,anon,authenticated;
grant all on public.check_queue_runs,public.check_queue_tasks to service_role;

-- 任务结果、历史和后续任务同事务提交；旧 owner 无权回填新 owner 的任务。
create function public.complete_check_queue_task(
  p_task_id uuid, p_owner uuid, p_result jsonb default null,
  p_children jsonb default '[]'::jsonb, p_error text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  t public.check_queue_tasks%rowtype;
  r public.check_queue_runs%rowtype;
  child jsonb;
  ids jsonb;
  terminal boolean;
begin
  select * into t from public.check_queue_tasks where id=p_task_id for update;
  if not found then raise exception '任务不存在'; end if;
  if t.status not in ('completed','failed') then
    if t.status <> 'running' or t.owner is distinct from p_owner
      or (p_error is null and t.lease_until <= now()) then
      raise exception '任务租约已失效';
    end if;
    terminal := p_error is null or t.attempts >= 3;
    if not terminal then
      update public.check_queue_tasks set status='pending', owner=null, lease_until=null,
        available_at=now()+interval '60 seconds', dispatched_at=null, last_error=left(p_error,1000)
      where id=t.id;
      return jsonb_build_object('retry',true,'tasks','[]'::jsonb);
    end if;
    if t.kind='check' and p_error is null and p_result is not null then
      if p_result->>'id' is distinct from t.config_id::text then raise exception '检测结果不匹配'; end if;
      insert into public.check_history(config_id,status,latency_ms,ping_latency_ms,checked_at,message,
        model_snapshot,group_snapshot,attribution_source,queue_task_id)
      values(t.config_id,p_result->>'status',(p_result->>'latencyMs')::integer,
        (p_result->>'pingLatencyMs')::integer,(p_result->>'checkedAt')::timestamptz,
        p_result->>'message',p_result->>'model',p_result->>'groupName','recorded',t.id);
    end if;
    update public.check_queue_tasks set status=case when p_error is null then 'completed' else 'failed' end,
      result=p_result, completed_at=now(), owner=null, lease_until=null, last_error=left(p_error,1000)
    where id=t.id;
    if p_error is null then
      for child in select value from jsonb_array_elements(p_children) loop
        insert into public.check_queue_tasks(run_id,task_key,parent_id,kind,config_id,payload,dispatched_at)
        values(t.run_id,child->>'key',t.id,child->>'kind',t.config_id,
          coalesce(child->'payload','{}'::jsonb),now()) on conflict do nothing;
      end loop;
    end if;
    if t.kind='check' then
      update public.check_queue_runs set completed_count=completed_count+1,
        checked_count=checked_count+case when p_result is not null then 1 else 0 end,
        issue_count=issue_count+case when p_result->>'status' in ('failed','error','validation_failed') then 1 else 0 end,
        error_count=error_count+case when p_error is not null then 1 else 0 end
      where id=t.run_id returning * into r;
      if r.completed_count=r.config_count then
        update public.check_queue_runs set status=case when r.issue_count+r.error_count>0 then 'failed' else 'success' end,
          finished_at=now() where id=r.id;
        update public.worker_trigger_logs set status=case when r.issue_count+r.error_count>0 then 'failed' else 'success' end,
          config_count=r.checked_count, issue_count=r.issue_count+r.error_count,
          duration_ms=least(2147483647,extract(epoch from now()-r.created_at)*1000)::integer,
          finished_at=now(), message=format('检测完成 %s/%s；模型异常 %s；任务失败 %s',r.checked_count,r.config_count,r.issue_count,r.error_count)
        where attempt_id=r.attempt_id;
        insert into public.check_queue_tasks(run_id,task_key,parent_id,kind,dispatched_at)
        values(r.id,'finish',t.id,'finish',now()) on conflict do nothing;
      end if;
    end if;
  end if;
  select coalesce(jsonb_agg(id),'[]'::jsonb) into ids from public.check_queue_tasks
    where parent_id=t.id and status='pending' and available_at<=now();
  return jsonb_build_object('retry',false,'tasks',ids,'failed',t.status='failed' or p_error is not null);
end;
$$;

create function public.claim_check_queue_task(p_task_id uuid,p_owner uuid)
returns setof public.check_queue_tasks language plpgsql security invoker set search_path = '' as $$
declare t public.check_queue_tasks%rowtype;
begin
  select * into t from public.check_queue_tasks where id=p_task_id for update;
  if not found then raise exception '任务不存在'; end if;
  if t.status in ('completed','failed') then return next t; return; end if;
  if t.available_at>now() or (t.status='running' and t.lease_until>now()) then return; end if;
  if t.attempts>=3 then
    -- 最后一次执行被终止时，同样收敛到明确失败，不永久停留在 running。
    update public.check_queue_tasks set status='running' where id=t.id;
    perform public.complete_check_queue_task(t.id,t.owner,null,'[]'::jsonb,'任务执行中断，已达到重试上限');
    select * into t from public.check_queue_tasks where id=p_task_id;
    return next t; return;
  end if;
  update public.check_queue_tasks set status='running',owner=p_owner,
    lease_until=now()+interval '120 seconds',attempts=attempts+1
  where id=p_task_id returning * into t;
  return next t;
end;
$$;

-- 每分钟进行廉价补偿扫描；稳定窗口键保证重试不会重复创建整轮检测。
create function public.dispatch_check_queue(p_attempt_id text,p_event text default 'scheduled')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare run_id uuid; ids jsonb;
begin
  perform pg_advisory_xact_lock(20261021,1);
  if not exists(select 1 from public.check_queue_runs where attempt_id=p_attempt_id)
    and not exists(select 1 from public.check_queue_runs where status='running') then
    insert into public.check_queue_runs(attempt_id) values(p_attempt_id) returning id into run_id;
    insert into public.worker_trigger_logs(attempt_id,trigger_type,worker_event,status)
      values(p_attempt_id,'worker',p_event,'running') on conflict do nothing;
    insert into public.check_queue_tasks(run_id,task_key,kind,config_id)
      select run_id,'check:'||c.id,'check',c.id from public.check_configs c
      where c.enabled and not coalesce(c.sync_disabled,false) and not c.is_maintenance
        and (c.paused_until is null or c.paused_until<=now());
    update public.check_queue_runs set config_count=(select count(*) from public.check_queue_tasks t where t.run_id=run_id)
      where id=run_id;
    if not exists(select 1 from public.check_queue_tasks t where t.run_id=run_id) then
      update public.check_queue_runs set status='success',finished_at=now() where id=run_id;
      update public.worker_trigger_logs set status='success',config_count=0,issue_count=0,finished_at=now(),message='没有待检测配置'
        where attempt_id=p_attempt_id;
      insert into public.check_queue_tasks(run_id,task_key,kind) values(run_id,'finish','finish');
    end if;
  end if;
  with ready as (
    select id from public.check_queue_tasks where
      ((status='pending' and available_at<=now()) or (status='running' and lease_until<=now()))
      and (dispatched_at is null or dispatched_at<now()-interval '3 minutes')
    order by available_at limit 500 for update skip locked
  ), dispatched as (
    update public.check_queue_tasks set dispatched_at=now() where id in(select id from ready) returning id
  ) select coalesce(jsonb_agg(id),'[]'::jsonb) into ids from dispatched;
  return jsonb_build_object('tasks',ids);
end;
$$;

-- 短期任务仅用于幂等与故障定位；检测历史仍按既有 30 天策略保留。
create function public.prune_check_queue() returns void
language sql security invoker set search_path = '' as $$
  delete from public.check_queue_runs r where r.created_at<now()-interval '3 days'
    and r.status<>'running' and not exists(
      select 1 from public.check_queue_tasks t where t.run_id=r.id and t.status in ('pending','running'));
$$;
revoke all on function public.complete_check_queue_task(uuid,uuid,jsonb,jsonb,text),
  public.claim_check_queue_task(uuid,uuid),public.dispatch_check_queue(text,text),public.prune_check_queue()
  from public,anon,authenticated;
grant execute on function public.complete_check_queue_task(uuid,uuid,jsonb,jsonb,text),
  public.claim_check_queue_task(uuid,uuid),public.dispatch_check_queue(text,text),public.prune_check_queue() to service_role;
