-- Sync jobs, their request/response logs and dead letters hold raw NetSuite
-- payloads. They were readable by every approved user and writable by managers.
-- Restrict all access to admin and developer roles; the edge functions and the
-- enqueue trigger use the service role / security definer and are unaffected.

do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['integration_sync_jobs', 'integration_payload_logs', 'integration_dead_letters'] loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;
    execute format(
      'create policy "Admins and developers manage %I" on public.%I for all to authenticated using (public.has_any_role(array[''admin''::public.app_role_code, ''developer''::public.app_role_code, ''dev''::public.app_role_code])) with check (public.has_any_role(array[''admin''::public.app_role_code, ''developer''::public.app_role_code, ''dev''::public.app_role_code]))',
      t, t
    );
  end loop;
end $$;
