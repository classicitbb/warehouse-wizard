-- A pallet can be physically stored while its receiving balance was never
-- completed, leaving status=receiving and available_quantity=0. Allow the
-- existing correction workflow to repair that specific state.
create or replace function public.begin_inventory_pallet_correction(in_inventory_balance_id uuid)
returns table (draft_id uuid, replacement_pallet_barcode text, former_location_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  balance_row public.inventory_balances%rowtype;
  pallet_row public.pallets%rowtype;
  location_row public.locations%rowtype;
  lot_row public.inventory_lots%rowtype;
  new_draft_id uuid;
  new_barcode text;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Inventory pallet corrections require Receiving permission.';
  end if;

  select * into balance_row from public.inventory_balances where id = in_inventory_balance_id for update;
  if not found then raise exception 'Inventory pallet was not found.'; end if;
  select * into pallet_row from public.pallets where id = balance_row.pallet_id for update;
  if not found then raise exception 'Pallet was not found.'; end if;
  if balance_row.correction_state is not null or pallet_row.correction_state is not null then
    raise exception 'This pallet already has a correction in progress or has been superseded.';
  end if;
  if not pallet_row.is_stored or pallet_row.current_location_id is null then
    raise exception 'Only a stored pallet can be returned to Receiving for correction.';
  end if;
  if (balance_row.status <> 'available' and not (balance_row.status = 'receiving' and coalesce(balance_row.available_quantity, 0) = 0))
     or coalesce(balance_row.reserved_quantity, 0) > 0 or coalesce(pallet_row.reserved_quantity, 0) > 0 then
    raise exception 'Clear reserved or allocated stock before correcting this pallet.';
  end if;

  select * into location_row from public.locations where id = pallet_row.current_location_id;
  select * into lot_row from public.inventory_lots where id = pallet_row.inventory_lot_id;
  new_barcode := public.inventory_correction_code('PLT');

  insert into public.receipts (receipt_number, receipt_type, reference_number, warehouse_id, client_id, status, draft_pallet_barcode, notes)
  values (
    public.inventory_correction_code('RCT'), 'other', new_barcode, balance_row.warehouse_id, balance_row.client_id, 'draft', new_barcode,
    jsonb_build_object(
      '_draft', true, 'source_type', 'inventory_pallet_correction', 'source_label', 'Inventory pallet correction',
      'correction_source_pallet_id', pallet_row.id, 'correction_source_balance_id', balance_row.id,
      'replacement_pallet_barcode', new_barcode, 'former_location_id', pallet_row.current_location_id,
      'former_location_code', location_row.code, 'product_id', pallet_row.product_id, 'client_id', pallet_row.client_id,
      'quantity', balance_row.quantity, 'expiry_date', lot_row.expiry_date, 'lot_number', lot_row.lot_number,
      'batch_number', lot_row.batch_number, 'inventory_lot_id', pallet_row.inventory_lot_id,
      'packaging_profile_id', pallet_row.packaging_profile_id,
      'original_pallet', jsonb_build_object('status', pallet_row.status, 'quantity', pallet_row.quantity, 'available_quantity', pallet_row.available_quantity, 'is_stored', pallet_row.is_stored, 'current_location_id', pallet_row.current_location_id),
      'original_balance', jsonb_build_object('status', balance_row.status, 'quantity', balance_row.quantity, 'available_quantity', balance_row.available_quantity, 'location_id', balance_row.location_id, 'zone_id', balance_row.zone_id)
    )::text
  ) returning id into new_draft_id;

  update public.pallets set correction_state = 'pending', available_quantity = 0 where id = pallet_row.id;
  update public.inventory_balances set correction_state = 'pending', available_quantity = 0 where id = balance_row.id;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, from_location_id, actor_user_id, metadata)
  values ('inventory_correction_started', 'pallets', pallet_row.id, balance_row.warehouse_id, pallet_row.id, pallet_row.current_location_id, auth.uid(), jsonb_build_object('draft_id', new_draft_id, 'replacement_pallet_barcode', new_barcode, 'former_location_code', location_row.code));

  return query select new_draft_id, new_barcode, location_row.code;
end;
$$;

grant execute on function public.begin_inventory_pallet_correction(uuid) to authenticated;

create or replace function public.complete_inventory_pallet_correction_in_place(
  in_draft_id uuid,
  in_quantity numeric
)
returns table(inventory_balance_id uuid, pallet_id uuid, pallet_barcode text)
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.receipts%rowtype;
  meta jsonb;
  old_pallet public.pallets%rowtype;
  old_balance public.inventory_balances%rowtype;
  former_location_id uuid;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Inventory pallet corrections require Receiving permission.';
  end if;
  if coalesce(in_quantity, 0) <= 0 then
    raise exception 'Quantity per pallet must be greater than zero.';
  end if;

  select * into draft_row from public.receipts where id = in_draft_id for update;
  if not found then raise exception 'Correction draft was not found.'; end if;
  meta := coalesce(draft_row.notes::jsonb, '{}'::jsonb);
  if meta->>'source_type' <> 'inventory_pallet_correction' or draft_row.status <> 'draft' then
    raise exception 'This correction has already been completed or cancelled.';
  end if;

  select * into old_pallet from public.pallets where id = (meta->>'correction_source_pallet_id')::uuid for update;
  select * into old_balance from public.inventory_balances where id = (meta->>'correction_source_balance_id')::uuid for update;
  if old_pallet.correction_state <> 'pending' or old_balance.correction_state <> 'pending' then
    raise exception 'The original pallet is no longer reserved for this correction.';
  end if;
  former_location_id := (meta->>'former_location_id')::uuid;
  if not old_pallet.is_stored or old_pallet.current_location_id is distinct from former_location_id
     or old_balance.location_id is distinct from former_location_id then
    raise exception 'The pallet is no longer at its former location. Send it through Put-Away.';
  end if;
  if (old_balance.status <> 'available' and not (old_balance.status = 'receiving' and coalesce(old_balance.available_quantity, 0) = 0))
     or coalesce(old_balance.reserved_quantity, 0) > 0 or coalesce(old_pallet.reserved_quantity, 0) > 0 then
    raise exception 'Clear reserved or allocated stock before correcting this pallet.';
  end if;

  update public.pallets
    set quantity = in_quantity, available_quantity = in_quantity, status = 'available', is_stored = true
    where id = old_pallet.id;
  update public.inventory_balances
    set quantity = in_quantity, available_quantity = in_quantity, status = 'available'
    where id = old_balance.id;
  update public.receipts set status = 'completed' where id = in_draft_id;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, from_location_id, to_location_id, actor_user_id, metadata)
  values (
    'inventory_pallet_correction_completed_in_place', 'pallets', old_pallet.id, old_balance.warehouse_id, old_pallet.id,
    former_location_id, former_location_id, auth.uid(),
    jsonb_build_object(
      'draft_id', in_draft_id, 'quantity', in_quantity, 'available_quantity', in_quantity,
      'previous_quantity', old_pallet.quantity, 'previous_available_quantity', old_pallet.available_quantity,
      'pallet_barcode', old_pallet.pallet_barcode, 'label_reprinted', false
    )
  );

  return query select old_balance.id, old_pallet.id, old_pallet.pallet_barcode;
end;
$$;

revoke all on function public.complete_inventory_pallet_correction_in_place(uuid, numeric) from public, anon;
grant execute on function public.complete_inventory_pallet_correction_in_place(uuid, numeric) to authenticated;
