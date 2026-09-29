-- ============================================================
-- System log archiving
--
-- Adds a destination table (system_logs_archive) and three functions:
--   - archive_system_log(in_id)             move one row (per-row UI action)
--   - archive_system_logs_older_than(days)   bulk-move rows past a cutoff
--                                             (default cutoff: 90 days)
--   - purge_expired_system_log_archive()     hard-delete archive rows once
--                                             they've been archived for
--                                             120+ days; scheduled to run
--                                             daily via pg_cron.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Archive table
-- ------------------------------------------------------------
create table if not exists public.system_logs_archive (
  id            uuid primary key,
  log_type      text not null,
  severity      text not null,
  title         text not null,
  message       text not null default '',
  details       jsonb,
  source        text,
  table_name    text,
  record_count  bigint,
  resolved      boolean not null default false,
  resolved_at   timestamptz,
  resolved_by   uuid,
  created_by    uuid,
  created_at    timestamptz not null,
  archived_at   timestamptz not null default now(),
  archived_by   uuid references auth.users (id) on delete set null
);

alter table public.system_logs_archive enable row level security;

create index if not exists idx_system_logs_archive_archived_at
  on public.system_logs_archive (archived_at);
create index if not exists idx_system_logs_archive_created_at
  on public.system_logs_archive (created_at);

drop policy if exists "Staff can read system logs archive" on public.system_logs_archive;
create policy "Staff can read system logs archive" on public.system_logs_archive
  for select to authenticated
  using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'developer')
    or public.has_role(auth.uid(), 'manager')
  );

grant select on public.system_logs_archive to authenticated;
grant all on public.system_logs_archive to service_role;

-- ------------------------------------------------------------
-- 2. Archive a single log entry (per-row action)
-- ------------------------------------------------------------
create or replace function public.archive_system_log(in_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.system_logs_archive (
    id, log_type, severity, title, message, details, source,
    table_name, record_count, resolved, resolved_at, resolved_by,
    created_by, created_at, archived_by
  )
  select
    id, log_type, severity, title, coalesce(message, ''), details, source,
    table_name, record_count, resolved, resolved_at, resolved_by,
    created_by, created_at, auth.uid()
  from public.system_logs
  where id = in_id
  on conflict (id) do nothing;

  delete from public.system_logs where id = in_id;
end;
$$;

grant execute on function public.archive_system_log(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. Bulk-archive logs older than N days (default 90)
-- ------------------------------------------------------------
create or replace function public.archive_system_logs_older_than(in_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - (greatest(coalesce(in_days, 90), 0) || ' days')::interval;
  moved_count integer;
begin
  with moved as (
    insert into public.system_logs_archive (
      id, log_type, severity, title, message, details, source,
      table_name, record_count, resolved, resolved_at, resolved_by,
      created_by, created_at, archived_by
    )
    select
      id, log_type, severity, title, coalesce(message, ''), details, source,
      table_name, record_count, resolved, resolved_at, resolved_by,
      created_by, created_at, auth.uid()
    from public.system_logs
    where created_at < cutoff
    on conflict (id) do nothing
    returning id
  )
  select count(*) into moved_count from moved;

  delete from public.system_logs where created_at < cutoff;

  return moved_count;
end;
$$;

grant execute on function public.archive_system_logs_older_than(integer) to authenticated;

-- ------------------------------------------------------------
-- 4. Purge archive rows older than 120 days
-- ------------------------------------------------------------
create or replace function public.purge_expired_system_log_archive()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  purged_count integer;
begin
  with purged as (
    delete from public.system_logs_archive
    where archived_at < now() - interval '120 days'
    returning id
  )
  select count(*) into purged_count from purged;

  return purged_count;
end;
$$;

grant execute on function public.purge_expired_system_log_archive() to service_role;

-- ------------------------------------------------------------
-- 5. Schedule the daily purge job (pg_cron already enabled by
--    20260511041728_email_infra.sql)
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-system-log-archive') then
    perform cron.unschedule('purge-system-log-archive');
  end if;
end $$;

select cron.schedule(
  'purge-system-log-archive',
  '0 3 * * *',
  $$select public.purge_expired_system_log_archive();$$
);
