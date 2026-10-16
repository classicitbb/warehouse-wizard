-- Whether NetSuite is set up and switched on, for every approved user.
-- integration_connections is readable only by managers and integration_secrets
-- only by the service role, so operational pages ask through this function to
-- decide whether to show NetSuite features. It returns a boolean and nothing else.
create or replace function public.netsuite_integration_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_approved() and exists (
    select 1
    from public.integration_connections c
    where c.system = 'netsuite'
      and c.enabled
      and coalesce(c.config->>'account_id', '') <> ''
      and coalesce(c.config->>'certificate_id', '') <> ''
      and exists (select 1 from public.integration_secrets s where s.connection_id = c.id and s.secret_type = 'netsuite_client_id')
      and exists (select 1 from public.integration_secrets s where s.connection_id = c.id and s.secret_type = 'netsuite_private_key')
  );
$$;

revoke all on function public.netsuite_integration_active() from public, anon;
grant execute on function public.netsuite_integration_active() to authenticated;
