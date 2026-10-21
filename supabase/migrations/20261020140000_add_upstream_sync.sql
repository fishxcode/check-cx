-- 同步状态独立于人工开关；默认不接管任何已有配置。
alter table public.check_configs
  add column if not exists sync_enabled boolean not null default false,
  add column if not exists sync_disabled boolean not null default false,
  add column if not exists sync_missing_count integer not null default 0,
  add column if not exists sync_checked_at timestamptz,
  add column if not exists sync_attempted_at timestamptz,
  add column if not exists sync_claim_token uuid;

create or replace function public.reset_upstream_sync_source()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(new.type,new.model,new.endpoint,new.api_key,new.group_name,new.request_header,new.sync_enabled)
    is distinct from row(old.type,old.model,old.endpoint,old.api_key,old.group_name,old.request_header,old.sync_enabled) then
    new.sync_disabled := false;
    new.sync_missing_count := 0;
    new.sync_checked_at := null;
    new.sync_attempted_at := null;
    new.sync_claim_token := null;
  end if;
  return new;
end;
$$;
drop trigger if exists reset_upstream_sync_source on public.check_configs;
create trigger reset_upstream_sync_source before update on public.check_configs
for each row execute function public.reset_upstream_sync_source();

-- 领取时间持久化，使网络失败与多实例并发也遵守五分钟间隔。
create or replace function public.claim_upstream_sync(p_ids text[] default null, p_limit integer default 200)
returns setof public.check_configs language sql security invoker set search_path = '' as $$
with due as (
  select id from public.check_configs
  where sync_enabled and not coalesce(locked,false)
    and (p_ids is null or id::text = any(p_ids))
    and (sync_attempted_at is null or sync_attempted_at <= statement_timestamp() - interval '5 minutes')
  order by sync_attempted_at nulls first, id
  limit least(greatest(p_limit,1),200) for update skip locked
)
update public.check_configs c set sync_attempted_at = statement_timestamp(), sync_claim_token = gen_random_uuid()
from due where c.id = due.id returning c.*;
$$;

create or replace function public.apply_upstream_sync(p_id text, p_claim_token uuid, p_expected_updated_at timestamptz, p_present boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  update public.check_configs set
    sync_missing_count = case when p_present then 0 else least(sync_missing_count+1,2) end,
    sync_disabled = case when p_present then false else sync_missing_count >= 1 end,
    sync_checked_at = statement_timestamp(), sync_claim_token = null
  where id::text = p_id and sync_claim_token = p_claim_token
    and updated_at is not distinct from p_expected_updated_at
    and sync_enabled and not coalesce(locked,false);
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function public.claim_upstream_sync(text[],integer) from public, anon, authenticated;
revoke all on function public.apply_upstream_sync(text,uuid,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.claim_upstream_sync(text[],integer) to service_role;
grant execute on function public.apply_upstream_sync(text,uuid,timestamptz,boolean) to service_role;
