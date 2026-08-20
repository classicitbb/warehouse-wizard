-- Editing a stored pallet: blank edits, save-as-draft, and pallet-number stability.
--
-- Three rules drive this migration:
--   1. An edit may be blank.  An operator can open a stored pallet, change
--      nothing, and still push it back to Drafts.
--   2. Cancelling leaves the pallet exactly as it was.  The only trace is an
--      audit record of the attempted edit, including what was typed.
--   3. A pallet number changes only when a committed edit needs a new label, or
--      when the pallet is returned to Drafts.  Re-opening an edit therefore
--      resumes the reserved number instead of minting another one.

-- begin_inventory_pallet_correction is now idempotent: an edit already pending
-- for this balance returns its existing draft (and its already-reserved
-- replacement number) instead of failing or reserving a second number.
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
  candidate public.receipts%rowtype;
  candidate_meta jsonb;
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

  if balance_row.correction_state = 'superseded' or pallet_row.correction_state = 'superseded' then
    raise exception 'This pallet has been superseded by a correction.';
  end if;

  -- Resume an edit that is already open on this pallet.
  if balance_row.correction_state = 'pending' or pallet_row.correction_state = 'pending' then
    for candidate in
      select * from public.receipts
      where status = 'draft' and notes like '%' || balance_row.id::text || '%'
      order by created_at desc
    loop
      begin
        candidate_meta := candidate.notes::jsonb;
      exception when others then
        continue;
      end;
      if candidate_meta->>'source_type' = 'inventory_pallet_correction'
         and candidate_meta->>'correction_source_balance_id' = balance_row.id::text then
        return query select
          candidate.id,
          candidate_meta->>'replacement_pallet_barcode',
          candidate_meta->>'former_location_code';
        return;
      end if;
    end loop;
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
  -- Reserved, not applied: the pallet keeps its own number until a committed
  -- edit prints a new label or the pallet is returned to Drafts.
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
      'source_pallet_barcode', pallet_row.pallet_barcode,
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

-- Cancelling records what the operator had typed before backing out, so an
-- abandoned edit still shows in the pallet's history.
drop function if exists public.cancel_inventory_pallet_correction(uuid);

create or replace function public.cancel_inventory_pallet_correction(
  in_draft_id uuid,
  in_attempted jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.receipts%rowtype;
  meta jsonb;
  pallet_id uuid;
  balance_id uuid;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Inventory pallet corrections require Receiving permission.';
  end if;
  select * into draft_row from public.receipts where id = in_draft_id for update;
  if not found then raise exception 'Correction draft was not found.'; end if;
  meta := coalesce(draft_row.notes::jsonb, '{}'::jsonb);
  if meta->>'source_type' <> 'inventory_pallet_correction' or draft_row.status <> 'draft' then
    raise exception 'This correction can no longer be cancelled.';
  end if;
  pallet_id := (meta->>'correction_source_pallet_id')::uuid;
  balance_id := (meta->>'correction_source_balance_id')::uuid;

  update public.pallets set
    correction_state = null,
    status = (meta->'original_pallet'->>'status')::public.inventory_status,
    quantity = (meta->'original_pallet'->>'quantity')::numeric,
    available_quantity = (meta->'original_pallet'->>'available_quantity')::numeric,
    is_stored = coalesce((meta->'original_pallet'->>'is_stored')::boolean, true),
    current_location_id = (meta->'original_pallet'->>'current_location_id')::uuid
    where id = pallet_id;
  update public.inventory_balances set
    correction_state = null,
    status = (meta->'original_balance'->>'status')::public.inventory_status,
    quantity = (meta->'original_balance'->>'quantity')::numeric,
    available_quantity = (meta->'original_balance'->>'available_quantity')::numeric,
    location_id = (meta->'original_balance'->>'location_id')::uuid,
    zone_id = (meta->'original_balance'->>'zone_id')::uuid
    where id = balance_id;
  update public.receipts set status = 'cancelled' where id = in_draft_id;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, actor_user_id, metadata)
  select 'inventory_correction_cancelled', 'pallets', p.id, b.warehouse_id, p.id, auth.uid(),
    jsonb_build_object(
      'draft_id', in_draft_id,
      'pallet_barcode', p.pallet_barcode,
      'attempted', coalesce(in_attempted, '{}'::jsonb),
      'restored_quantity', (meta->'original_pallet'->>'quantity')::numeric,
      'restored_expiry_date', meta->>'expiry_date'
    )
  from public.pallets p join public.inventory_balances b on b.pallet_id = p.id where p.id = pallet_id;
end;
$$;

revoke all on function public.cancel_inventory_pallet_correction(uuid, jsonb) from public, anon;
grant execute on function public.cancel_inventory_pallet_correction(uuid, jsonb) to authenticated;

-- Save as draft.  The edit does not have to change anything: the stored pallet
-- is retired and its replacement waits in Receiving > Drafts, where printing the
-- label and receiving it creates the pallet under the new number.
create or replace function public.save_inventory_pallet_correction_as_draft(
  in_draft_id uuid,
  in_quantity numeric default null,
  in_expiry_date date default null,
  in_expiry_provided boolean default false
)
returns table (draft_id uuid, draft_pallet_barcode text, quantity numeric, expiry_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.receipts%rowtype;
  meta jsonb;
  old_pallet public.pallets%rowtype;
  old_balance public.inventory_balances%rowtype;
  eff_quantity numeric;
  eff_expiry date;
  new_barcode text;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Inventory pallet corrections require Receiving permission.';
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
  if coalesce(old_balance.reserved_quantity, 0) > 0 or coalesce(old_pallet.reserved_quantity, 0) > 0 then
    raise exception 'Clear reserved or allocated stock before returning this pallet to Drafts.';
  end if;

  -- A blank edit keeps whatever the pallet already carried.
  eff_quantity := coalesce(in_quantity, (meta->>'quantity')::numeric, old_balance.quantity, old_pallet.quantity);
  if coalesce(eff_quantity, 0) <= 0 then
    raise exception 'Quantity per pallet must be greater than zero.';
  end if;
  eff_expiry := case when in_expiry_provided then in_expiry_date else (meta->>'expiry_date')::date end;
  new_barcode := coalesce(meta->>'replacement_pallet_barcode', draft_row.draft_pallet_barcode, public.inventory_correction_code('PLT'));

  update public.pallets
    set correction_state = 'superseded', quantity = 0, available_quantity = 0, current_location_id = null, is_stored = false
    where id = old_pallet.id;
  update public.inventory_balances
    set correction_state = 'superseded', quantity = 0, available_quantity = 0, location_id = null, zone_id = null
    where id = old_balance.id;

  -- Rewritten as an ordinary standalone-pallet draft so Receiving prints and
  -- receives it through the normal draft path.
  update public.receipts set
    status = 'draft',
    draft_pallet_barcode = new_barcode,
    notes = (meta || jsonb_build_object(
      '_draft', true,
      '_standalone_pallet', true,
      'entry_mode', 'pallet',
      'receipt_type', 'other',
      'source_type', 'inventory_pallet_edit_draft',
      'source_label', 'Pallet edit returned to drafts',
      'draft_pallet_barcode', new_barcode,
      'quantity', eff_quantity,
      'expiry_date', eff_expiry,
      'superseded_pallet_id', old_pallet.id,
      'superseded_pallet_barcode', old_pallet.pallet_barcode,
      'returned_to_drafts_at', now()
    ))::text
    where id = in_draft_id;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, from_location_id, actor_user_id, metadata)
  values (
    'inventory_pallet_edit_returned_to_drafts', 'pallets', old_pallet.id, old_balance.warehouse_id, old_pallet.id,
    (meta->>'former_location_id')::uuid, auth.uid(),
    jsonb_build_object(
      'draft_id', in_draft_id,
      'superseded_pallet_barcode', old_pallet.pallet_barcode,
      'draft_pallet_barcode', new_barcode,
      'quantity', eff_quantity,
      'expiry_date', eff_expiry,
      'previous_quantity', old_pallet.quantity,
      'blank_edit', in_quantity is null and not in_expiry_provided
    )
  );

  return query select in_draft_id, new_barcode, eff_quantity, eff_expiry;
end;
$$;

revoke all on function public.save_inventory_pallet_correction_as_draft(uuid, numeric, date, boolean) from public, anon;
grant execute on function public.save_inventory_pallet_correction_as_draft(uuid, numeric, date, boolean) to authenticated;
