DROP FUNCTION IF EXISTS public.confirm_pick_task(uuid, text, text, numeric, boolean, boolean);

CREATE OR REPLACE FUNCTION public.preview_pick_source_override(in_task_id uuid, in_pick_list_code text, in_scanned_pallet_barcode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  task_row public.pick_tasks%rowtype;
  pick_list_row public.pick_lists%rowtype;
  actual_pallet public.pallets%rowtype;
  actual_balance public.inventory_balances%rowtype;
  actual_location public.locations%rowtype;
  expected_product_id uuid;
  expected_sku text;
begin
  if auth.uid() is null or not public.is_approved() then
    raise exception 'Not authorized to preview picks';
  end if;
  select * into task_row from public.pick_tasks where id = in_task_id;
  if not found or task_row.status in ('completed', 'cancelled') then
    raise exception 'Pick task is not open.';
  end if;
  select * into pick_list_row from public.pick_lists where id = task_row.pick_list_id;
  if not found or not public.can_access_warehouse(pick_list_row.warehouse_id) then
    raise exception 'Not authorized for this warehouse';
  end if;
  if upper(trim(pick_list_row.pick_list_number)) <> upper(trim(in_pick_list_code)) then
    raise exception 'Scanned pick list does not match this pick task.';
  end if;

  select coalesce(ol.product_id, directed_pallet.product_id) into expected_product_id
  from public.pallets directed_pallet
  left join public.order_lines ol on ol.id = task_row.order_line_id
  where directed_pallet.id = task_row.pallet_id;
  select sku into expected_sku from public.products where id = expected_product_id;

  select p.* into actual_pallet from public.pallets p
  where upper(trim(p.pallet_barcode)) = upper(trim(in_scanned_pallet_barcode));
  if not found then raise exception 'Scanned pallet was not found.'; end if;
  select * into actual_balance from public.inventory_balances where pallet_id = actual_pallet.id;
  if not found then raise exception 'Scanned pallet has no inventory balance.'; end if;
  select * into actual_location from public.locations where id = actual_balance.location_id;
  if not found then raise exception 'Scanned pallet is not in a pickable location.'; end if;

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
  if actual_pallet.id <> task_row.pallet_id and exists (
    select 1 from public.pick_tasks other_task
    where other_task.pallet_id = actual_pallet.id
      and other_task.id <> task_row.id
      and other_task.status in ('queued', 'assigned', 'in_progress')
  ) then
    raise exception 'This pallet is already directed to another active pick task.';
  end if;

  return jsonb_build_object(
    'sku', expected_sku,
    'requested_quantity', task_row.requested_quantity,
    'scanned_available_quantity', least(actual_balance.available_quantity, actual_pallet.available_quantity),
    'quantity_variance', least(actual_balance.available_quantity, actual_pallet.available_quantity) <> task_row.requested_quantity,
    'variance_delta', least(actual_balance.available_quantity, actual_pallet.available_quantity) - task_row.requested_quantity,
    'directed_pallet_id', task_row.pallet_id,
    'directed_location_id', task_row.location_id,
    'scanned_pallet_id', actual_pallet.id,
    'scanned_pallet_barcode', actual_pallet.pallet_barcode,
    'scanned_location_id', actual_location.id,
    'scanned_location_code', actual_location.code,
    'source_override', task_row.pallet_id is distinct from actual_pallet.id
      or task_row.location_id is distinct from actual_location.id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_pick_task(
  in_task_id uuid,
  in_pick_list_code text,
  in_scanned_pallet_barcode text,
  in_confirmed_quantity numeric,
  in_allow_quantity_anomaly boolean DEFAULT false,
  in_confirm_source_override boolean DEFAULT false,
  in_allow_source_quantity_variance boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  task_row public.pick_tasks%rowtype;
  pick_list_row public.pick_lists%rowtype;
  actual_pallet public.pallets%rowtype;
  actual_balance public.inventory_balances%rowtype;
  actual_location public.locations%rowtype;
  expected_product_id uuid;
  is_source_override boolean := false;
  is_quantity_anomaly boolean := false;
  is_quantity_variance boolean := false;
  effective_quantity numeric(14,2);
  remaining_quantity numeric(14,2);
  shortfall_quantity numeric(14,2);
  variance_note text;
  all_done boolean;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'Not authorized to confirm picks'; end if;
  select * into task_row from public.pick_tasks where id = in_task_id for update;
  if not found then raise exception 'Pick task not found'; end if;
  if task_row.status in ('completed', 'cancelled') then raise exception 'Pick task is already closed. Refresh the pick list.'; end if;
  if task_row.pallet_id is null then raise exception 'Task is not linked to a pallet.'; end if;
  if not (in_confirm_source_override and in_allow_source_quantity_variance)
     and coalesce(in_confirmed_quantity, 0) <> task_row.requested_quantity then
    raise exception 'Confirm the original requested quantity of %.', task_row.requested_quantity;
  end if;

  select * into pick_list_row from public.pick_lists where id = task_row.pick_list_id;
  if not found or not public.can_access_warehouse(pick_list_row.warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;
  if upper(trim(pick_list_row.pick_list_number)) <> upper(trim(in_pick_list_code)) then raise exception 'Scanned pick list does not match this pick task.'; end if;
  select coalesce(ol.product_id, directed_pallet.product_id) into expected_product_id
  from public.pallets directed_pallet left join public.order_lines ol on ol.id = task_row.order_line_id
  where directed_pallet.id = task_row.pallet_id;

  select p.* into actual_pallet from public.pallets p
  where upper(trim(p.pallet_barcode)) = upper(trim(in_scanned_pallet_barcode)) for update;
  if not found then raise exception 'Scanned pallet was not found.'; end if;
  select * into actual_balance from public.inventory_balances where pallet_id = actual_pallet.id for update;
  if not found then raise exception 'Scanned pallet has no inventory balance.'; end if;
  select * into actual_location from public.locations where id = actual_balance.location_id;
  if not found then raise exception 'Scanned pallet is not in a pickable location.'; end if;

  if actual_balance.warehouse_id <> pick_list_row.warehouse_id or actual_pallet.current_warehouse_id <> pick_list_row.warehouse_id then raise exception 'Scanned pallet is not in this pick list warehouse.'; end if;
  if actual_pallet.product_id <> expected_product_id or actual_balance.product_id <> expected_product_id then raise exception 'Scanned pallet SKU does not match the requested pick SKU.'; end if;
  if actual_balance.status <> 'available' or actual_balance.available_quantity <= 0 then raise exception 'Scanned pallet has no available stock to pick.'; end if;
  perform public.assert_location_not_frozen(actual_balance.location_id, actual_pallet.id);

  is_source_override := task_row.pallet_id is distinct from actual_pallet.id or task_row.location_id is distinct from actual_location.id;
  if is_source_override and not in_confirm_source_override then raise exception 'Source differs from the directed pallet. Review and explicitly override the source first.'; end if;
  if is_source_override and exists (
    select 1 from public.pick_tasks other_task where other_task.pallet_id = actual_pallet.id and other_task.id <> task_row.id
      and other_task.status in ('queued', 'assigned', 'in_progress')
  ) then raise exception 'This pallet is already directed to another active pick task.'; end if;

  effective_quantity := task_row.requested_quantity;
  if actual_balance.available_quantity <> task_row.requested_quantity or actual_pallet.available_quantity <> task_row.requested_quantity then
    if is_source_override then
      if not in_allow_source_quantity_variance then
        raise exception 'Alternate pallet full quantity must exactly match the requested quantity of %.', task_row.requested_quantity;
      end if;
      effective_quantity := least(actual_balance.available_quantity, actual_pallet.available_quantity);
      is_quantity_variance := true;
    else
      if not in_allow_quantity_anomaly then raise exception 'PICK_QTY_ANOMALY: available=%;requested=%', actual_balance.available_quantity, task_row.requested_quantity; end if;
      effective_quantity := actual_balance.available_quantity;
      is_quantity_anomaly := true;
    end if;
  end if;

  shortfall_quantity := greatest(task_row.requested_quantity - effective_quantity, 0);

  remaining_quantity := greatest(actual_balance.available_quantity - effective_quantity, 0);
  update public.pallets set available_quantity = remaining_quantity, quantity = greatest(quantity - effective_quantity, 0),
    reserved_quantity = case when remaining_quantity = 0 then 0 else reserved_quantity end,
    status = case when remaining_quantity = 0 then 'shipped'::public.inventory_status else status end,
    current_location_id = case when remaining_quantity = 0 then null else current_location_id end,
    is_stored = case when remaining_quantity = 0 then false else is_stored end where id = actual_pallet.id;
  update public.inventory_balances set available_quantity = remaining_quantity, quantity = greatest(quantity - effective_quantity, 0),
    reserved_quantity = case when remaining_quantity = 0 then 0 else reserved_quantity end,
    status = case when remaining_quantity = 0 then 'shipped'::public.inventory_status else status end,
    location_id = case when remaining_quantity = 0 then null else location_id end,
    zone_id = case when remaining_quantity = 0 then null else zone_id end where id = actual_balance.id;

  if is_source_override then
    insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, from_location_id, actor_user_id, metadata)
    values ('pick_source_released', 'pick_tasks', task_row.id, pick_list_row.warehouse_id, task_row.pallet_id, task_row.location_id, auth.uid(),
      jsonb_build_object('reassigned_to_pallet_id', actual_pallet.id, 'reassigned_to_location_id', actual_location.id, 'requested_quantity', task_row.requested_quantity));
  end if;

  if is_quantity_variance then
    variance_note := format('Operator substituted pallet %s and picked %s (requested %s).',
      actual_pallet.pallet_barcode, effective_quantity, task_row.requested_quantity);
    if shortfall_quantity > 0 then
      variance_note := variance_note || format(' Short by %s.', shortfall_quantity);
    end if;
  elsif is_quantity_anomaly then
    variance_note := format('Override: pallet only had %s available (requested %s).', effective_quantity, task_row.requested_quantity);
  else
    variance_note := null;
  end if;

  update public.pick_tasks set
    original_pallet_id = case when is_source_override then coalesce(original_pallet_id, task_row.pallet_id) else original_pallet_id end,
    original_location_id = case when is_source_override then coalesce(original_location_id, task_row.location_id) else original_location_id end,
    pallet_id = actual_pallet.id,
    location_id = actual_location.id,
    picked_pallet_id = actual_pallet.id,
    picked_location_id = actual_location.id,
    source_override_reason = case when is_source_override then 'Operator confirmed matching alternate source' else null end,
    source_reassigned_at = case when is_source_override then timezone('utc', now()) else source_reassigned_at end,
    confirmed_quantity = effective_quantity,
    short_reason = variance_note,
    status = case when is_quantity_anomaly then 'exception'::public.task_status else 'completed'::public.task_status end,
    completed_at = timezone('utc', now()) where id = task_row.id;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, from_location_id, actor_user_id, metadata)
  values (case when is_source_override then 'pick_source_override' else 'pick' end, 'pick_tasks', task_row.id, pick_list_row.warehouse_id, actual_pallet.id, actual_location.id, auth.uid(),
    jsonb_build_object('confirmed_quantity', effective_quantity, 'requested_quantity', task_row.requested_quantity, 'source_override', is_source_override,
      'quantity_variance', is_quantity_variance, 'scanned_quantity', least(actual_balance.available_quantity, actual_pallet.available_quantity),
      'shortfall', shortfall_quantity,
      'directed_pallet_id', task_row.pallet_id, 'directed_location_id', task_row.location_id, 'picked_pallet_id', actual_pallet.id,
      'picked_location_id', actual_location.id, 'remaining_quantity', remaining_quantity, 'location_cleared', remaining_quantity = 0));

  select bool_and(status in ('completed', 'cancelled', 'exception')) into all_done from public.pick_tasks where pick_list_id = task_row.pick_list_id;
  if coalesce(all_done, false) then
    update public.pick_lists set status = 'completed' where id = pick_list_row.id and status not in ('completed', 'cancelled');
    if pick_list_row.order_id is not null then update public.orders set status = 'completed' where id = pick_list_row.order_id; end if;
  end if;
  return jsonb_build_object('confirmed_quantity', effective_quantity, 'source_override', is_source_override,
    'quantity_variance', is_quantity_variance, 'shortfall', shortfall_quantity,
    'picked_pallet_id', actual_pallet.id, 'picked_location_id', actual_location.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_pick_shortfall_task(in_task_id uuid, in_quantity numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  task_row public.pick_tasks%rowtype;
  pick_list_row public.pick_lists%rowtype;
  product_row public.products%rowtype;
  expected_product_id uuid;
  candidate record;
  new_task_id uuid;
  new_task_number text;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'Not authorized to create pick tasks'; end if;
  if coalesce(in_quantity, 0) <= 0 then raise exception 'Shortfall quantity must be greater than zero.'; end if;

  select * into task_row from public.pick_tasks where id = in_task_id;
  if not found then raise exception 'Pick task not found'; end if;
  select * into pick_list_row from public.pick_lists where id = task_row.pick_list_id;
  if not found or not public.can_access_warehouse(pick_list_row.warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;

  select coalesce(ol.product_id, p.product_id) into expected_product_id
  from public.pallets p left join public.order_lines ol on ol.id = task_row.order_line_id
  where p.id = coalesce(task_row.picked_pallet_id, task_row.pallet_id);
  select * into product_row from public.products where id = expected_product_id;

  select ib.pallet_id, ib.location_id, ib.available_quantity into candidate
  from public.inventory_balances ib
  where ib.product_id = expected_product_id
    and ib.warehouse_id = pick_list_row.warehouse_id
    and ib.status = 'available'
    and ib.available_quantity > 0
    and ib.location_id is not null
    and not exists (
      select 1 from public.inventory_freezes f
      where f.location_id = ib.location_id and f.status = 'active'
    )
    and not exists (
      select 1 from public.pick_tasks t
      where t.pallet_id = ib.pallet_id and t.status in ('queued', 'assigned', 'in_progress')
    )
  order by
    case when coalesce(product_row.rotation_method, 'fifo') = 'fefo'
      then coalesce(ib.expiry_date, date '9999-12-31')::text
      else coalesce(ib.received_at, timezone('utc', now()))::text
    end asc
  limit 1;

  new_task_number := 'PKT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.pick_tasks (task_number, pick_list_id, order_line_id, pallet_id, location_id, requested_quantity, status, short_reason)
  values (
    new_task_number,
    task_row.pick_list_id,
    task_row.order_line_id,
    candidate.pallet_id,
    candidate.location_id,
    coalesce(candidate.available_quantity, in_quantity),
    case when candidate.pallet_id is null then 'exception'::public.task_status else 'queued'::public.task_status end,
    case when candidate.pallet_id is null then format('No available pallet found for the remaining %s.', in_quantity)
      else format('Follow-up task for shortfall of %s.', in_quantity) end
  )
  returning id into new_task_id;

  update public.pick_lists set status = 'in_progress'
  where id = task_row.pick_list_id and status in ('completed');

  if pick_list_row.order_id is not null then
    update public.orders set status = 'in_progress' where id = pick_list_row.order_id and status = 'completed';
  end if;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, to_location_id, actor_user_id, metadata)
  values ('pick_shortfall_task_created', 'pick_tasks', new_task_id, pick_list_row.warehouse_id, candidate.pallet_id, candidate.location_id, auth.uid(),
    jsonb_build_object('source_task_id', task_row.id, 'shortfall_quantity', in_quantity));

  return jsonb_build_object('task_id', new_task_id, 'task_number', new_task_number, 'pallet_found', candidate.pallet_id is not null);
end;
$function$;

REVOKE ALL ON FUNCTION public.confirm_pick_task(uuid, text, text, numeric, boolean, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.confirm_pick_task(uuid, text, text, numeric, boolean, boolean, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.create_pick_shortfall_task(uuid, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.create_pick_shortfall_task(uuid, numeric) TO authenticated;