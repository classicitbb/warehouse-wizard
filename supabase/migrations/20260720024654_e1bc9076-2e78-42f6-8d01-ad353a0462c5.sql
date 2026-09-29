create or replace function public.claim_integration_sync_jobs(
  p_connection_id uuid,
  p_limit integer
)
returns setof public.integration_sync_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id from public.integration_sync_jobs
    where connection_id = p_connection_id
      and status = 'queued'
    order by created_at
    limit greatest(coalesce(p_limit, 1), 1)
    for update skip locked
  )
  update public.integration_sync_jobs j
     set status = 'running',
         updated_at = now()
    from candidates c
   where j.id = c.id
  returning j.*;
end;
$$;

revoke all on function public.claim_integration_sync_jobs(uuid, integer) from public;
grant execute on function public.claim_integration_sync_jobs(uuid, integer) to service_role;

create or replace function public.reclaim_stale_integration_sync_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  reclaimed integer;
begin
  with reset as (
    update public.integration_sync_jobs
       set status = 'queued', updated_at = now()
     where status = 'running'
       and updated_at < now() - interval '5 minutes'
    returning id
  )
  select count(*) into reclaimed from reset;
  return reclaimed;
end;
$$;

revoke all on function public.reclaim_stale_integration_sync_jobs() from public;
grant execute on function public.reclaim_stale_integration_sync_jobs() to service_role;