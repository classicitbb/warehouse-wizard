-- NetSuite queue: claim only what the outbound worker can actually send,
-- plus a retention schedule for the integration audit trail.
--
-- WHY THE CLAIM FILTER EXISTS
-- netsuite-webhook parks inbound purchase_order / sales_order / transfer_order
-- / fulfillment / inventory records in integration_sync_jobs with
-- status='queued', deliberately, for processors that have not been built yet.
-- claim_integration_sync_jobs previously filtered on status alone, so the
-- moment anything drained the queue, process-netsuite-queue would claim those
-- rows, hit its "Unsupported job_type for outbound sync" branch, treat the
-- failure as permanent and dead-letter every one of them. Nothing scheduled the
-- worker until now, which is the only reason that never fired in production.
--
-- The two-argument signature is DROPPED rather than replaced: adding a
-- defaulted third parameter creates an overload, and the existing
-- two-argument call site would then be ambiguous.

drop function if exists public.claim_integration_sync_jobs(uuid, integer);

create or replace function public.claim_integration_sync_jobs(
  p_connection_id uuid,
  p_limit integer,
  p_job_types text[] default array['inventory_adjustment']
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
      and job_type = any(p_job_types)
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

revoke all on function public.claim_integration_sync_jobs(uuid, integer, text[]) from public;
grant execute on function public.claim_integration_sync_jobs(uuid, integer, text[]) to service_role;

-- Supporting index for the filtered claim.
create index if not exists idx_integration_sync_jobs_claim
  on public.integration_sync_jobs (connection_id, status, job_type, created_at);

-- ============================================================
-- Retention
--
-- integration_payload_logs stores every raw inbound and outbound body and had
-- no purge, so it grew without bound and had no answer for "how long do you
-- keep this?" in a security review. pg_cron is already enabled on this project
-- (see 20260717010000_system_logs_archiving.sql); this follows the guarded
-- schedule/unschedule pattern from 20260915120000_web_push_notifications.sql.
--
-- 90 days of raw payloads is enough to debug a sync dispute; 365 days of
-- succeeded job headers is enough to prove one happened. Deleting a job
-- cascades its payload logs by FK, while integration_dead_letters is
-- "on delete set null", so unresolved failures are never aged out here.
-- ============================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-integration-payload-logs') then
      perform cron.unschedule('purge-integration-payload-logs');
    end if;
    perform cron.schedule(
      'purge-integration-payload-logs',
      '25 3 * * *',
      $job$delete from public.integration_payload_logs where created_at < now() - interval '90 days'$job$
    );

    if exists (select 1 from cron.job where jobname = 'purge-succeeded-integration-sync-jobs') then
      perform cron.unschedule('purge-succeeded-integration-sync-jobs');
    end if;
    perform cron.schedule(
      'purge-succeeded-integration-sync-jobs',
      '35 3 * * *',
      $job$delete from public.integration_sync_jobs where status = 'succeeded' and updated_at < now() - interval '365 days'$job$
    );
  end if;
end;
$$;
