-- Pick-source override: retain the directed source on the task while recording
-- the pallet/location actually picked. The transaction below is the only
-- application commit path for pick confirmation, so the inventory debit and
-- movement history cannot diverge.

alter table public.pick_tasks
  add column if not exists picked_pallet_id uuid references public.pallets(id) on delete set null,
  add column if not exists picked_location_id uuid references public.locations(id) on delete set null,
  add column if not exists source_override_reason text;

create index if not exists idx_pick_tasks_picked_pallet on public.pick_tasks(picked_pallet_id);

create or replace function public.confirm_pick_task(
  in_task_id uuid,
  in_scanned_location_code text,
  in_scanned_pallet_barcode text,
  in_confirmed_quantity numeric,
  in_allow_quantity_anomaly boolean default false,
  in_source_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.pick_tasks%rowtype;
  pick_list_row public.pick_lists%rowtype;
  actual_pallet public.pallets%rowtype;
  actual_balance public.inventory_balances%rowtype;
  actual_location public.locations%rowtype;
  expected_product_id uuid;
  is_source_override boolean := false;
  is_quantity_anomaly boolean := false;
  effective_quantity numeric(14,2);
  remaining_quantity numeric(14,2);
  final_short_reason text;
  all_done boolean;
begin
  if auth.uid() is null or not public.is_approved() then
    raise exception 'Not authorized to confirm picks';
  end if;

  select * into task_row
  from public.pick_tasks
  where id = in_task_id
  for update;
  if not found then
    raise exception 'Pick task not found';
  end if;
  if task_row.status in ('completed', 'cancelled') then
    raise exception 'Pick task is already closed. Refresh the pick list.';
  end if;
  if task_row.pallet_id is null then
    raise exception 'Task is not linked to a pallet.';
  end if;
  if coalesce(in_confirmed_quantity, 0) <= 0 then
    raise exception 'Confirmed pick quantity must be greater than zero.';
  end if;
  if in_confirmed_quantity <> task_row.requested_quantity then
    raise exception 'Confirm the original requested quantity of %.', task_row.requested_quantity;
  end if;

  select * into pick_list_row from public.pick_lists where id = task_row.pick_list_id;
  if not found or not public.can_access_warehouse(pick_list_row.warehouse_id) then
    raise exception 'Not authorized for this warehouse';
  end if;

  select coalesce(ol.product_id, p.product_id) into expected_product_id
  from public.pallets p
  left join public.order_lines ol on ol.id = task_row.order_line_id
  where p.id = task_row.pallet_id;
  if expected_product_id is null then
    raise exception 'Could not resolve the SKU requested by this pick task.';
  end if;

  select p.* into actual_pallet
  from public.pallets p
  where upper(trim(p.pallet_barcode)) = upper(trim(in_scanned_pallet_barcode))
  for update;
  if not found then
    raise exception 'Scanned pallet was not found.';
  end if;

  select ib.* into actual_balance
  from public.inventory_balances ib
  where ib.pallet_id = actual_pallet.id
  for update;
  if not found then
    raise exception 'Scanned pallet has no inventory balance.';
  end if;

  select * into actual_location
  from public.locations l
  where upper(trim(l.code)) = upper(trim(in_scanned_location_code));
  if not found then
    raise exception 'Scanned location was not found.';
  end if;
  if actual_balance.location_id is distinct from actual_location.id then
    raise exception 'Scanned location does not match the selected pallet location.';
  end if;
  if actual_balance.warehouse_id <> pick_list_row.warehouse_id
    or actual_pallet.current_warehouse_id <> pick_list_row.warehouse_id then
    raise exception 'Scanned pallet is not in this pick list warehouse.';
  end if;
  if actual_pallet.product_id <> expected_product_id or actual_balance.product_id <> expected_product_id then
    raise exception 'Scanned pallet SKU does not match the requested pick SKU.';
  end if;
  if actual_balance.status <> 'available' or actual_balance.available_quantity <= 0 then
    raise exception 'Scanned pallet has no available stock to pick.';
  end if;
  perform public.assert_location_not_frozen(actual_balance.location_id, actual_pallet.id);

  is_source_override := task_row.pallet_id is distinct from actual_pallet.id
    or task_row.location_id is distinct from actual_location.id;
  if is_source_override and nullif(trim(in_source_override_reason), '') is null then
    raise exception 'A reason is required when picking an alternate pallet or location.';
  end if;
  if is_source_override and exists (
    select 1
    from public.pick_tasks other_task
    where other_task.pallet_id = actual_pallet.id
      and other_task.id <> task_row.id
      and other_task.status in ('queued', 'assigned', 'in_progress')
  ) then
    raise exception 'This pallet is already directed to another active pick task.';
  end if;

  effective_quantity := task_row.requested_quantity;
  if actual_balance.available_quantity <> task_row.requested_quantity
    or actual_pallet.available_quantity <> task_row.requested_quantity then
    if is_source_override then
      raise exception 'Alternate pallet quantity must exactly match the requested quantity of %.', task_row.requested_quantity;
    end if;
    if not in_allow_quantity_anomaly then
      raise exception 'PICK_QTY_ANOMALY: available=%;requested=%', actual_balance.available_quantity, task_row.requested_quantity;
    end if;
    if actual_balance.available_quantity <= 0 then
      raise exception 'This pallet has no remaining stock to pick. Cancel or reassign this pick task.';
    end if;
    effective_quantity := actual_balance.available_quantity;
    is_quantity_anomaly := true;
  end if;

  remaining_quantity := greatest(actual_balance.available_quantity - effective_quantity, 0);
  update public.pallets
  set available_quantity = remaining_quantity,
      quantity = greatest(quantity - effective_quantity, 0),
      reserved_quantity = case when remaining_quantity = 0 then 0 else reserved_quantity end,
      status = case when remaining_quantity = 0 then 'shipped'::public.inventory_status else status end,
      current_location_id = case when remaining_quantity = 0 then null else current_location_id end,
      is_stored = case when remaining_quantity = 0 then false else is_stored end
  where id = actual_pallet.id;

  update public.inventory_balances
  set available_quantity = remaining_quantity,
      quantity = greatest(quantity - effective_quantity, 0),
      reserved_quantity = case when remaining_quantity = 0 then 0 else reserved_quantity end,
      status = case when remaining_quantity = 0 then 'shipped'::public.inventory_status else status end,
      location_id = case when remaining_quantity = 0 then null else location_id end,
      zone_id = case when remaining_quantity = 0 then null else zone_id end
  where id = actual_balance.id;

  final_short_reason := case
    when is_quantity_anomaly then format('Override: pallet only had %s available (requested %s).', effective_quantity, task_row.requested_quantity)
    else null
  end;
  update public.pick_tasks
  set confirmed_quantity = effective_quantity,
      picked_pallet_id = actual_pallet.id,
      picked_location_id = actual_location.id,
      source_override_reason = case when is_source_override then trim(in_source_override_reason) else null end,
      short_reason = final_short_reason,
      status = case when final_short_reason is null then 'completed'::public.task_status else 'exception'::public.task_status end,
      completed_at = timezone('utc', now())
  where id = task_row.id;

  insert into public.audit_events (
    event_type, entity_table, entity_id, warehouse_id, pallet_id,
    from_location_id, actor_user_id, metadata
  ) values (
    case when is_source_override then 'pick_source_override' else 'pick' end,
    'pick_tasks', task_row.id, pick_list_row.warehouse_id, actual_pallet.id,
    actual_location.id, auth.uid(), jsonb_build_object(
      'confirmed_quantity', effective_quantity,
      'requested_quantity', task_row.requested_quantity,
      'quantity_anomaly_override', is_quantity_anomaly,
      'source_override', is_source_override,
      'source_override_reason', case when is_source_override then trim(in_source_override_reason) else null end,
      'directed_pallet_id', task_row.pallet_id,
      'directed_location_id', task_row.location_id,
      'picked_pallet_id', actual_pallet.id,
      'picked_location_id', actual_location.id,
      'remaining_quantity', remaining_quantity,
      'location_cleared', remaining_quantity = 0
    )
  );

  select bool_and(status in ('completed', 'cancelled', 'exception')) into all_done
  from public.pick_tasks where pick_list_id = task_row.pick_list_id;
  if coalesce(all_done, false) then
    update public.pick_lists set status = 'completed' where id = pick_list_row.id and status not in ('completed', 'cancelled');
    if pick_list_row.order_id is not null then
      update public.orders set status = 'completed' where id = pick_list_row.order_id;
    end if;
  end if;

  return jsonb_build_object(
    'confirmed_quantity', effective_quantity,
    'source_override', is_source_override,
    'quantity_anomaly_override', is_quantity_anomaly,
    'picked_pallet_id', actual_pallet.id,
    'picked_location_id', actual_location.id
  );
end;
$$;

revoke all on function public.confirm_pick_task(uuid, text, text, numeric, boolean, text) from public, anon;
grant execute on function public.confirm_pick_task(uuid, text, text, numeric, boolean, text) to authenticated;
