-- 先在完整历史中识别状态变化，再按事件发生时归属筛选。
create or replace function public.get_public_status_events(p_models text[] default null, p_group text default null, p_limit integer default 30)
returns table(event_id text, model_name text, group_name text, status text, previous_status text, checked_at timestamptz)
language sql stable security invoker set search_path = '' as $$
with ordered as (
  select h.id::text as event_id, h.model_snapshot as model_name,
    coalesce(nullif(h.group_snapshot,''),'__ungrouped__') as group_name,
    h.status::text as status,
    lag(h.status::text) over (partition by h.config_id order by h.checked_at,h.id) as previous_status,
    lag(h.model_snapshot) over (partition by h.config_id order by h.checked_at,h.id) as previous_model,
    h.checked_at from public.check_history h
)
select o.event_id,o.model_name,o.group_name,o.status,o.previous_status,o.checked_at from ordered o
where o.previous_model is not distinct from o.model_name and o.previous_status is not null and o.previous_status is distinct from o.status and o.model_name is not null
  and (p_models is null or o.model_name = any(p_models)) and (p_group is null or o.group_name = p_group)
order by o.checked_at desc,o.event_id desc limit greatest(1,least(coalesce(p_limit,30),100));
$$;
revoke all on function public.get_public_status_events(text[],text,integer) from public,anon,authenticated;
grant execute on function public.get_public_status_events(text[],text,integer) to service_role;
