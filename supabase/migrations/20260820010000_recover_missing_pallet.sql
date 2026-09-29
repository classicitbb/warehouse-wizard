-- Recovering a missing pallet that has turned up without a location.
--
-- Two honest outcomes, and they follow the same pallet-number rule as the
-- stored-pallet edit screen:
--   * Send to Put-Away — the physical pallet and its label are intact, so it
--     keeps its own number and simply needs a home. No label is printed.
--   * Save as draft — the pallet is retired and the stock waits in
--     Receiving > Drafts under a new number, because a draft is printed and
--     received as a new pallet.

create or replace function public.recover_missing_pallet_to_putaway(in_inventory_balance_id uuid)
returns table (pallet_id uuid, pallet_barcode text, putaway_task_id uuid, putaway_task_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  balance_row public.inventory_balances%rowtype;
  pallet_row public.pallets%rowtype;
  former_location_id uuid;
  effective_quantity numeric;
  existing_task public.putaway_tasks%rowtype;
  suggested_location_id uuid;
  new_task_id uuid;
  new_task_number text;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Recovering a missing pallet requires Receiving permission.';
  end if;

  select * into balance_row from public.inventory_balances where id = in_inventory_balance_id for update;
  if not found then raise exception 'Inventory pallet was not found.'; end if;
  select * into pallet_row from public.pallets where id = balance_row.pallet_id for update;
  if not found then raise exception 'Pallet was not found.'; end if;
  if balance_row.correction_state is not null or pallet_row.correction_state is not null then
    raise exception 'This pallet is part of a correction. Finish or cancel that first.';
  end if;
  if balance_row.status <> 'missing' and pallet_row.status <> 'missing' then
    raise exception 'Only a missing pallet can be recovered.';
  end if;

  former_location_id := coalesce(balance_row.location_id, pallet_row.current_location_id);
  effective_quantity := coalesce(nullif(balance_row.quantity, 0), nullif(pallet_row.quantity, 0), 0);
  if effective_quantity <= 0 then
    raise exception 'This pallet has no quantity left to put away. Return it to Drafts instead.';
  end if;

  -- The pallet number is untouched: the label on the pallet is still the truth.
  update public.pallets set
    status = 'receiving',
    is_stored = false,
    current_location_id = null,
    current_warehouse_id = coalesce(pallet_row.current_warehouse_id, balance_row.warehouse_id),
    quantity = effective_quantity,
    available_quantity = 0
    where id = pallet_row.id;
  update public.inventory_balances set
    status = 'receiving',
    location_id = null,
    zone_id = null,
    quantity = effective_quantity,
    available_quantity = 0
    where id = balance_row.id;

  select * into existing_task from public.putaway_tasks
    where pallet_id = pallet_row.id and status in ('draft', 'queued', 'assigned', 'in_progress')
    order by created_at desc limit 1;
  if found then
    new_task_id := existing_task.id;
    new_task_number := existing_task.task_number;
  else
    select location_id into suggested_location_id from public.directed_putaway_candidates(pallet_row.id) limit 1;
    new_task_number := public.inventory_correction_code('PTA');
    insert into public.putaway_tasks (task_number, pallet_id, warehouse_id, suggested_location_id, status)
    values (new_task_number, pallet_row.id, balance_row.warehouse_id, suggested_location_id, 'queued')
    returning id into new_task_id;
  end if;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, from_location_id, actor_user_id, metadata)
  values (
    'missing_pallet_sent_to_putaway', 'pallets', pallet_row.id, balance_row.warehouse_id, pallet_row.id, former_location_id, auth.uid(),
    jsonb_build_object(
      'pallet_barcode', pallet_row.pallet_barcode,
      'quantity', effective_quantity,
      'putaway_task_id', new_task_id,
      'putaway_task_number', new_task_number,
      'label_reprinted', false
    )
  );

  return query select pallet_row.id, pallet_row.pallet_barcode, new_task_id, new_task_number;
end;
$$;

revoke all on function public.recover_missing_pallet_to_putaway(uuid) from public, anon;
grant execute on function public.recover_missing_pallet_to_putaway(uuid) to authenticated;

create or replace function public.recover_missing_pallet_to_draft(
  in_inventory_balance_id uuid,
  in_quantity numeric default null
)
returns table (draft_id uuid, draft_pallet_barcode text, quantity numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  balance_row public.inventory_balances%rowtype;
  pallet_row public.pallets%rowtype;
  lot_row public.inventory_lots%rowtype;
  location_row public.locations%rowtype;
  effective_quantity numeric;
  new_barcode text;
  new_draft_id uuid;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Recovering a missing pallet requires Receiving permission.';
  end if;

  select * into balance_row from public.inventory_balances where id = in_inventory_balance_id for update;
  if not found then raise exception 'Inventory pallet was not found.'; end if;
  select * into pallet_row from public.pallets where id = balance_row.pallet_id for update;
  if not found then raise exception 'Pallet was not found.'; end if;
  if balance_row.correction_state is not null or pallet_row.correction_state is not null then
    raise exception 'This pallet is part of a correction. Finish or cancel that first.';
  end if;
  if balance_row.status <> 'missing' and pallet_row.status <> 'missing' then
    raise exception 'Only a missing pallet can be recovered.';
  end if;

  effective_quantity := coalesce(in_quantity, nullif(balance_row.quantity, 0), nullif(pallet_row.quantity, 0), 0);
  if effective_quantity <= 0 then
    raise exception 'Enter the quantity found before returning this pallet to Drafts.';
  end if;

  select * into lot_row from public.inventory_lots where id = coalesce(balance_row.inventory_lot_id, pallet_row.inventory_lot_id);
  select * into location_row from public.locations where id = coalesce(balance_row.location_id, pallet_row.current_location_id);
  -- Returned to Drafts, so a new number is minted; it becomes real when the
  -- draft label is printed and received.
  new_barcode := public.inventory_correction_code('PLT');

  insert into public.receipts (receipt_number, receipt_type, reference_number, warehouse_id, client_id, status, draft_pallet_barcode, notes)
  values (
    public.inventory_correction_code('RCT'), 'other', new_barcode, balance_row.warehouse_id, balance_row.client_id, 'draft', new_barcode,
    jsonb_build_object(
      '_draft', true,
      '_standalone_pallet', true,
      'entry_mode', 'pallet',
      'receipt_type', 'other',
      'source_type', 'missing_pallet_recovery',
      'source_label', 'Found pallet returned to drafts',
      'draft_pallet_barcode', new_barcode,
      'product_id', pallet_row.product_id,
      'client_id', pallet_row.client_id,
      'quantity', effective_quantity,
      'expiry_date', lot_row.expiry_date,
      'lot_number', lot_row.lot_number,
      'batch_number', lot_row.batch_number,
      'inventory_lot_id', pallet_row.inventory_lot_id,
      'packaging_profile_id', pallet_row.packaging_profile_id,
      'superseded_pallet_id', pallet_row.id,
      'superseded_pallet_barcode', pallet_row.pallet_barcode,
      'former_location_code', location_row.code,
      'returned_to_drafts_at', now()
    )::text
  ) returning id into new_draft_id;

  update public.pallets set
    correction_state = 'superseded', quantity = 0, available_quantity = 0, current_location_id = null, is_stored = false
    where id = pallet_row.id;
  update public.inventory_balances set
    correction_state = 'superseded', quantity = 0, available_quantity = 0, location_id = null, zone_id = null
    where id = balance_row.id;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, actor_user_id, metadata)
  values (
    'missing_pallet_returned_to_drafts', 'pallets', pallet_row.id, balance_row.warehouse_id, pallet_row.id, auth.uid(),
    jsonb_build_object(
      'draft_id', new_draft_id,
      'superseded_pallet_barcode', pallet_row.pallet_barcode,
      'draft_pallet_barcode', new_barcode,
      'quantity', effective_quantity
    )
  );

  return query select new_draft_id, new_barcode, effective_quantity;
end;
$$;

revoke all on function public.recover_missing_pallet_to_draft(uuid, numeric) from public, anon;
grant execute on function public.recover_missing_pallet_to_draft(uuid, numeric) to authenticated;
