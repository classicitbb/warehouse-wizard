-- Part 1: extend reset_wms_data to also wipe non-developer users
create or replace function public.reset_wms_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  dev_ids uuid[];
  removed_users int := 0;
  kept_users int := 0;
begin
  if auth.uid() is null or not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer')) then
    raise exception 'Only admins or developers can reset the WMS environment';
  end if;

  select coalesce(array_agg(distinct ur.user_id), array[]::uuid[])
    into dev_ids
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where r.code = 'developer';

  update public.profiles set default_warehouse_id = null where default_warehouse_id is not null;

  truncate table
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
    public.system_logs
  restart identity cascade;

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

  -- Remove role assignments for non-dev users, then their profiles, then auth users
  delete from public.user_roles where not (user_id = any(dev_ids));

  -- Reset warehouse scoping on remaining (dev) role rows
  update public.user_roles
  set warehouse_id = null,
      is_hidden = false,
      hidden_at = null,
      hidden_reason = null;

  with deleted as (
    delete from public.profiles where not (id = any(dev_ids)) returning id
  )
  select count(*) into removed_users from deleted;

  delete from auth.users where not (id = any(dev_ids));

  select count(*) into kept_users from public.profiles where id = any(dev_ids);

  return jsonb_build_object(
    'status', 'ok',
    'deleted_users', removed_users,
    'kept_users', kept_users,
    'message', 'Warehouse data reset complete. Launch the setup wizard to rebuild the environment.'
  );
end;
$$;

grant execute on function public.reset_wms_data() to authenticated;

-- Part 2: child-aware hard delete RPCs

create or replace function public._delete_guard_check()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer');
$$;

create or replace function public.delete_warehouse_cascade(in_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  blockers jsonb := '[]'::jsonb;
  c bigint;
begin
  if not public._delete_guard_check() then
    raise exception 'Only admins or developers can delete warehouses';
  end if;

  select count(*) into c from public.zones where warehouse_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','zones','count',c); end if;
  select count(*) into c from public.locations where warehouse_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','locations','count',c); end if;
  select count(*) into c from public.pallets where current_warehouse_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','pallets','count',c); end if;
  select count(*) into c from public.inventory_balances where warehouse_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','inventory_balances','count',c); end if;
  select count(*) into c from public.orders where warehouse_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','orders','count',c); end if;
  select count(*) into c from public.pick_lists where warehouse_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','pick_lists','count',c); end if;
  select count(*) into c from public.putaway_tasks where warehouse_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','putaway_tasks','count',c); end if;
  select count(*) into c from public.move_tasks where warehouse_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','move_tasks','count',c); end if;
  select count(*) into c from public.dock_appointments where warehouse_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','dock_appointments','count',c); end if;
  select count(*) into c from public.cycle_counts where warehouse_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','cycle_counts','count',c); end if;
  select count(*) into c from public.printer_stations where warehouse_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','printer_stations','count',c); end if;

  if jsonb_array_length(blockers) > 0 then
    return jsonb_build_object('ok', false, 'blocked_by', blockers);
  end if;

  delete from public.warehouses where id = in_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_zone_cascade(in_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  blockers jsonb := '[]'::jsonb;
  c bigint;
begin
  if not public._delete_guard_check() then
    raise exception 'Only admins or developers can delete zones';
  end if;

  select count(*) into c from public.locations where zone_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','locations','count',c); end if;
  select count(*) into c from public.inventory_balances where zone_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','inventory_balances','count',c); end if;
  select count(*) into c from public.cycle_counts where zone_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','cycle_counts','count',c); end if;

  if jsonb_array_length(blockers) > 0 then
    return jsonb_build_object('ok', false, 'blocked_by', blockers);
  end if;

  delete from public.zones where id = in_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_location_cascade(in_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  blockers jsonb := '[]'::jsonb;
  c bigint;
begin
  if not public._delete_guard_check() then
    raise exception 'Only admins or developers can delete locations';
  end if;

  select count(*) into c from public.pallets where current_location_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','pallets','count',c); end if;
  select count(*) into c from public.inventory_balances where location_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','inventory_balances','count',c); end if;
  select count(*) into c from public.putaway_tasks where suggested_location_id = in_id or confirmed_location_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','putaway_tasks','count',c); end if;
  select count(*) into c from public.move_tasks where from_location_id = in_id or to_location_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','move_tasks','count',c); end if;
  select count(*) into c from public.pick_tasks where location_id = in_id or staging_location_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','pick_tasks','count',c); end if;
  select count(*) into c from public.cycle_count_lines where location_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','cycle_count_lines','count',c); end if;

  if jsonb_array_length(blockers) > 0 then
    return jsonb_build_object('ok', false, 'blocked_by', blockers);
  end if;

  delete from public.locations where id = in_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_product_cascade(in_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  blockers jsonb := '[]'::jsonb;
  c bigint;
begin
  if not public._delete_guard_check() then
    raise exception 'Only admins or developers can delete products';
  end if;

  select count(*) into c from public.pallets where product_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','pallets','count',c); end if;
  select count(*) into c from public.inventory_balances where product_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','inventory_balances','count',c); end if;
  select count(*) into c from public.inventory_lots where product_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','inventory_lots','count',c); end if;
  select count(*) into c from public.order_lines where product_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','order_lines','count',c); end if;
  select count(*) into c from public.product_packaging_profiles where product_id = in_id and is_hidden = false;
  if c > 0 then blockers := blockers || jsonb_build_object('table','product_packaging_profiles','count',c); end if;

  if jsonb_array_length(blockers) > 0 then
    return jsonb_build_object('ok', false, 'blocked_by', blockers);
  end if;

  -- safe to remove any remaining hidden packaging profiles
  delete from public.product_packaging_profiles where product_id = in_id;
  delete from public.products where id = in_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_client_cascade(in_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  blockers jsonb := '[]'::jsonb;
  c bigint;
begin
  if not public._delete_guard_check() then
    raise exception 'Only admins or developers can delete clients';
  end if;

  select count(*) into c from public.products where client_owner_id = in_id and active = true;
  if c > 0 then blockers := blockers || jsonb_build_object('table','products','count',c); end if;
  select count(*) into c from public.pallets where client_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','pallets','count',c); end if;
  select count(*) into c from public.inventory_balances where client_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','inventory_balances','count',c); end if;
  select count(*) into c from public.orders where client_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','orders','count',c); end if;
  select count(*) into c from public.pick_lists where client_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','pick_lists','count',c); end if;
  select count(*) into c from public.inventory_lots where client_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','inventory_lots','count',c); end if;

  if jsonb_array_length(blockers) > 0 then
    return jsonb_build_object('ok', false, 'blocked_by', blockers);
  end if;

  delete from public.clients where id = in_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.delete_warehouse_cascade(uuid) to authenticated;
grant execute on function public.delete_zone_cascade(uuid) to authenticated;
grant execute on function public.delete_location_cascade(uuid) to authenticated;
grant execute on function public.delete_product_cascade(uuid) to authenticated;
grant execute on function public.delete_client_cascade(uuid) to authenticated;