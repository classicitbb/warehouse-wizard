CREATE OR REPLACE FUNCTION public.ensure_putaway_task_for_pallet(in_pallet_id uuid)
RETURNS TABLE(putaway_task_id uuid, putaway_task_number text, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  pallet_row public.pallets%rowtype;
  balance_row public.inventory_balances%rowtype;
  existing_task public.putaway_tasks%rowtype;
  v_warehouse_id uuid;
  v_suggested_location_id uuid;
  v_task_id uuid;
  v_task_number text;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Queuing Put-Away work requires Receiving permission.';
  end if;

  select * into pallet_row from public.pallets where id = in_pallet_id for update;
  if not found then raise exception 'Pallet was not found.'; end if;

  select * into balance_row from public.inventory_balances where pallet_id = pallet_row.id limit 1;

  v_warehouse_id := coalesce(pallet_row.current_warehouse_id, balance_row.warehouse_id);
  if v_warehouse_id is null then raise exception 'This pallet has no warehouse, so Put-Away cannot be queued.'; end if;
  if not public.can_access_warehouse(v_warehouse_id) then raise exception 'You do not have access to this warehouse.'; end if;

  if pallet_row.status <> 'putaway' or pallet_row.is_stored is true or pallet_row.current_location_id is not null then
    raise exception 'This pallet is not waiting for Put-Away.';
  end if;
  if pallet_row.correction_state is not null then
    raise exception 'This pallet is part of a correction. Finish or cancel that first.';
  end if;

  select * into existing_task from public.putaway_tasks
    where pallet_id = pallet_row.id and status in ('draft', 'queued', 'assigned', 'in_progress', 'exception')
    order by created_at desc limit 1;
  if found then
    return query select existing_task.id, existing_task.task_number, false;
    return;
  end if;

  select location_id into v_suggested_location_id from public.directed_putaway_candidates(pallet_row.id) limit 1;
  v_task_number := public.inventory_correction_code('PTA');
  insert into public.putaway_tasks (task_number, pallet_id, warehouse_id, suggested_location_id, status)
  values (v_task_number, pallet_row.id, v_warehouse_id, v_suggested_location_id, 'queued')
  returning id into v_task_id;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, actor_user_id, metadata)
  values (
    'putaway_task_requeued', 'putaway_tasks', v_task_id, v_warehouse_id, pallet_row.id, auth.uid(),
    jsonb_build_object(
      'pallet_barcode', pallet_row.pallet_barcode,
      'putaway_task_number', v_task_number,
      'reason', 'pallet marked for put-away without an open task'
    )
  );

  return query select v_task_id, v_task_number, true;
end;
$function$;

REVOKE ALL ON FUNCTION public.ensure_putaway_task_for_pallet(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ensure_putaway_task_for_pallet(uuid) TO authenticated, service_role;