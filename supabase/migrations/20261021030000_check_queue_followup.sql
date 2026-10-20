-- 已执行 20261021010000/20261021020000 后的增量修复。
-- 只补列和函数，不重复建表、不重复 rename。
alter table public.check_queue_runs add column if not exists interval_seconds integer;
alter table public.check_queue_runs alter column interval_seconds set default 1800;
alter table public.check_queue_runs drop constraint if exists check_queue_runs_interval_seconds_check;
alter table public.check_queue_runs add constraint check_queue_runs_interval_seconds_check check (interval_seconds between 60 and 3600);
update public.check_queue_runs set interval_seconds=1800 where interval_seconds is null;
alter table public.check_queue_runs alter column interval_seconds set not null;
alter table public.monitoring_statistics_cache add column if not exists history_revision timestamptz;

-- 已有配置保留原值；只有缺少此设置时才使用较保守的 30 分钟。
insert into public.site_settings(key,value,description,editable,value_type)
values('check_poll_interval_seconds','1800','检测间隔（秒，60～3600），下次调度时生效；上一轮未完成不叠加',true,'number')
on conflict(key) do update set description=excluded.description;

drop function if exists public.dispatch_check_queue(text,text);

create or replace function public.complete_check_queue_task(
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
    if t.kind='check' and p_error is null and p_result is not null
      and exists(select 1 from public.alert_rules where enabled
        and (config_ids is null or t.config_id=any(config_ids))) then
      insert into public.check_queue_tasks(run_id,task_key,parent_id,kind,config_id,payload,dispatched_at)
      values(t.run_id,'alerts:'||t.id,t.id,'alerts',t.config_id,jsonb_build_object('result',p_result),now());
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

create or replace function public.claim_check_queue_task(p_task_id uuid,p_owner uuid)
returns setof public.check_queue_tasks language plpgsql security invoker set search_path = '' as $$
declare t public.check_queue_tasks%rowtype;
begin
  select * into t from public.check_queue_tasks where id=p_task_id for update;
  if not found then return; end if;
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

create or replace function public.dispatch_check_queue(p_attempt_id text,p_event text default 'scheduled',p_interval_seconds integer default 1800)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_run_id uuid;
  ids jsonb;
  v_raw text;
  v_interval integer := 1800;
  v_now timestamptz;
  v_attempt text;
  v_latest timestamptz;
begin
  perform pg_advisory_xact_lock(20261021,1);
  v_now := clock_timestamp();
  select value into v_raw from public.site_settings where key='check_poll_interval_seconds';
  -- 后台是唯一周期来源；保留参数仅用于兼容旧版本调用。
  if v_raw ~ '^[0-9]{1,4}$' then
    if v_raw::integer between 60 and 3600 then v_interval := v_raw::integer; end if;
  end if;
  v_attempt := 'queue:'||v_interval||':'||floor(extract(epoch from v_now)/v_interval)::bigint;
  select max(created_at) into v_latest from public.check_queue_runs;
  if (v_latest is null or v_latest+make_interval(secs=>v_interval)<=v_now)
    and not exists(select 1 from public.check_queue_runs where attempt_id=v_attempt)
    and not exists(select 1 from public.check_queue_runs where status='running') then
    insert into public.check_queue_runs(attempt_id,interval_seconds,created_at)
      values(v_attempt,v_interval,v_now) returning id into v_run_id;
    insert into public.worker_trigger_logs(attempt_id,trigger_type,worker_event,status)
      values(v_attempt,'worker',p_event,'running') on conflict do nothing;
    insert into public.check_queue_tasks(run_id,task_key,kind,config_id)
      select v_run_id,'check:'||c.id,'check',c.id from public.check_configs c
      where c.enabled and not coalesce(c.sync_disabled,false) and not c.is_maintenance
        and (c.paused_until is null or c.paused_until<=now());
    update public.check_queue_runs set config_count=(select count(*) from public.check_queue_tasks t where t.run_id=v_run_id)
      where id=v_run_id;
    if not exists(select 1 from public.check_queue_tasks t where t.run_id=v_run_id) then
      update public.check_queue_runs set status='success',finished_at=now() where id=v_run_id;
      update public.worker_trigger_logs set status='success',config_count=0,issue_count=0,finished_at=now(),message='没有待检测配置'
        where attempt_id=v_attempt;
      insert into public.check_queue_tasks(run_id,task_key,kind) values(v_run_id,'finish','finish');
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
  return jsonb_build_object('tasks',ids,'attemptId',v_attempt,'intervalSeconds',v_interval);
end;
$$;

create or replace function public.get_check_queue_results(p_run_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(result),'[]'::jsonb) from public.check_queue_tasks
  where run_id=p_run_id and kind='check' and status='completed' and result is not null;
$$;

create or replace function public.get_monitoring_statistics(p_vendors jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  mapping jsonb := coalesce(p_vendors,'{}'::jsonb);
  key text;
  snapshot jsonb;
  computed timestamptz;
  revision timestamptz;
  cached_revision timestamptz;
begin
  if jsonb_typeof(mapping)<>'object' then raise exception '无效厂家映射'; end if;
  key := md5(mapping::text);
  select c.value,c.computed_at,c.history_revision into snapshot,computed,cached_revision from public.monitoring_statistics_cache c
    where c.cache_key=key and c.vendors=mapping;
  if computed>clock_timestamp()-interval '60 seconds' then return snapshot; end if;
  select max(checked_at) into revision from public.check_history;
  -- 没有新检测时只按五分钟刷新滚动时间窗口，避免空闲访问不断重算。
  if computed>clock_timestamp()-interval '5 minutes' and revision is not distinct from cached_revision then return snapshot; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('monitoring:'||key,0)) then
    -- 已有刷新时保留原 asOf，有限陈旧结果不能伪装成新计算的统计。
    if computed>clock_timestamp()-interval '2 minutes' then return snapshot; end if;
    perform pg_advisory_xact_lock(hashtextextended('monitoring:'||key,0));
  end if;
  select c.value,c.computed_at,c.history_revision into snapshot,computed,cached_revision from public.monitoring_statistics_cache c
    where c.cache_key=key and c.vendors=mapping;
  if computed>clock_timestamp()-interval '60 seconds' then return snapshot; end if;
  if computed>clock_timestamp()-interval '5 minutes' and revision is not distinct from cached_revision then return snapshot; end if;
  snapshot := public.get_monitoring_statistics_raw(mapping);
  insert into public.monitoring_statistics_cache(cache_key,vendors,value,history_revision,computed_at)
    values(key,mapping,snapshot,revision,clock_timestamp()) on conflict(cache_key) do update
      set vendors=excluded.vendors,value=excluded.value,history_revision=excluded.history_revision,computed_at=excluded.computed_at;
  delete from public.monitoring_statistics_cache where computed_at<clock_timestamp()-interval '1 day';
  return snapshot;
end;
$$;

revoke all on function public.complete_check_queue_task(uuid,uuid,jsonb,jsonb,text), public.claim_check_queue_task(uuid,uuid), public.dispatch_check_queue(text,text,integer), public.get_check_queue_results(uuid), public.get_monitoring_statistics(jsonb) from public, anon, authenticated;
grant execute on function public.complete_check_queue_task(uuid,uuid,jsonb,jsonb,text), public.claim_check_queue_task(uuid,uuid), public.dispatch_check_queue(text,text,integer), public.get_check_queue_results(uuid), public.get_monitoring_statistics(jsonb) to service_role;
