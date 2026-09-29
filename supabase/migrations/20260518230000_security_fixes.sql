-- Security fixes: tighten integration_connections SELECT, restrict resolve_login_code, gate write_system_log

-- 1. Remove broad approved-user read on integration_connections (credentials live here)
drop policy if exists "Approved users read integration_connections" on public.integration_connections;

-- 2. Restrict resolve_login_code to authenticated only (prevent anon enumeration of emails)
revoke execute on function public.resolve_login_code(text) from anon;

-- 3. Add approval guard to write_system_log so unapproved users cannot pollute audit log
create or replace function public.write_system_log(
  in_log_type     text,
  in_severity     text,
  in_title        text,
  in_message      text default null,
  in_details      jsonb default null,
  in_source       text default null,
  in_table_name   text default null,
  in_record_count bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_id uuid;
begin
  if auth.uid() is null or not public.is_approved() then
    raise exception 'Access denied: approved user required to write system log';
  end if;

  insert into public.system_logs (
    log_type, severity, title, message, details,
    source, table_name, record_count, created_by
  )
  values (
    in_log_type, in_severity, in_title, in_message, in_details,
    in_source, in_table_name, in_record_count, auth.uid()
  )
  returning id into new_id;
  return new_id;
end;
$$;
