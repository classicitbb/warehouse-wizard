-- Make Settings > Reset all a true clean-slate operation.
-- Preserves developer access, removes seeded/non-developer users, and clears
-- newer tables that were added after the original reset RPC.

insert into public.roles (code, name, description)
values
  ('developer', 'Developer', 'Full system capabilities including developer tooling, role management, and all configuration'),
  ('admin', 'Admin', 'Full access across the entire warehouse management system')
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      updated_at = timezone('utc', now());

create or replace function public.reset_wms_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user uuid := auth.uid();
  preserved_user_ids uuid[];
  preserved_user_count integer := 0;
  removed_user_count integer := 0;
  developer_role_id uuid;
  admin_role_id uuid;
  preserved_id uuid;
begin
  if actor_user is null or not (
    public.has_role(actor_user, 'admin') or public.has_role(actor_user, 'developer')
  ) then
    raise exception 'Only admins and developers can reset the WMS environment';
  end if;

  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
  into preserved_user_ids
  from public.profiles p
  left join public.user_roles ur on ur.user_id = p.id
  left join public.roles r on r.id = ur.role_id
  where r.code = 'developer'
     or lower(coalesce(p.email, '')) = 'russelljhunte@gmail.com';

  if coalesce(array_length(preserved_user_ids, 1), 0) = 0 then
    preserved_user_ids := array[actor_user];
  end if;

  select count(*) into removed_user_count
  from auth.users
  where not (id = any(preserved_user_ids));

  update public.profiles
  set default_warehouse_id = null,
      active = true,
      approved = true,
      updated_at = timezone('utc', now())
  where id = any(preserved_user_ids);

  update public.user_roles
  set warehouse_id = null,
      is_hidden = false,
      hidden_at = null,
      hidden_reason = null,
      updated_at = timezone('utc', now())
  where user_id = any(preserved_user_ids);

  truncate table
    public.email_send_log,
    public.suppressed_emails,
    public.email_unsubscribe_tokens,
    public.user_device_trust,
    public.ai_recommendations,
    public.integration_payload_logs,
    public.integration_dead_letters,
    public.integration_sync_jobs,
    public.external_record_links,
    public.integration_connections,
    public.report_exports,
    public.report_definitions,
    public.print_jobs,
    public.label_templates,
    public.printer_stations,
    public.work_templates,
    public.client_variables,
    public.licence_events,
    public.deployment_subscription,
    public.system_logs
  restart identity cascade;

  insert into public.email_send_state (
    id,
    retry_after_until,
    batch_size,
    send_delay_ms,
    auth_email_ttl_minutes,
    transactional_email_ttl_minutes,
    updated_at
  )
  values (1, null, 10, 200, 15, 60, timezone('utc', now()))
  on conflict (id) do update
    set retry_after_until = excluded.retry_after_until,
        batch_size = excluded.batch_size,
        send_delay_ms = excluded.send_delay_ms,
        auth_email_ttl_minutes = excluded.auth_email_ttl_minutes,
        transactional_email_ttl_minutes = excluded.transactional_email_ttl_minutes,
        updated_at = excluded.updated_at;

  truncate table
    public.audit_events,
    public.barcode_labels,
    public.stock_adjustments,
    public.cycle_count_lines,
    public.cycle_counts,
    public.staging_loads,
    public.dock_appointments,
    public.replenishment_tasks,
    public.quality_inspections,
    public.return_authorizations,
    public.transfer_lines,
    public.transfers,
    public.pick_tasks,
    public.pick_lists,
    public.order_lines,
    public.orders,
    public.move_tasks,
    public.putaway_tasks,
    public.inventory_balances,
    public.pallets,
    public.receipt_lines,
    public.receipts,
    public.inventory_lots,
    public.product_packaging_profiles,
    public.products,
    public.clients,
    public.locations,
    public.zones,
    public.warehouses
  restart identity cascade;

  delete from auth.users
  where not (id = any(preserved_user_ids));

  delete from public.profiles
  where not (id = any(preserved_user_ids));

  delete from public.user_roles
  where not (user_id = any(preserved_user_ids));

  select id into developer_role_id from public.roles where code = 'developer';
  select id into admin_role_id from public.roles where code = 'admin';

  foreach preserved_id in array preserved_user_ids loop
    if developer_role_id is not null
       and exists (select 1 from public.profiles where id = preserved_id)
       and not exists (
         select 1 from public.user_roles
         where user_id = preserved_id and role_id = developer_role_id and warehouse_id is null
       )
    then
      insert into public.user_roles (user_id, role_id, warehouse_id)
      values (preserved_id, developer_role_id, null);
    end if;

    if admin_role_id is not null
       and exists (select 1 from public.profiles where id = preserved_id)
       and not exists (
         select 1 from public.user_roles
         where user_id = preserved_id and role_id = admin_role_id and warehouse_id is null
       )
    then
      insert into public.user_roles (user_id, role_id, warehouse_id)
      values (preserved_id, admin_role_id, null);
    end if;
  end loop;

  select count(*) into preserved_user_count
  from public.profiles
  where id = any(preserved_user_ids);

  return jsonb_build_object(
    'status', 'ok',
    'message', 'Warehouse data reset complete. Launch the setup wizard to rebuild the environment.',
    'preserved_users', preserved_user_count,
    'removed_users', removed_user_count
  );
end;
$$;

revoke execute on function public.reset_wms_data() from anon, public;
grant execute on function public.reset_wms_data() to authenticated;
