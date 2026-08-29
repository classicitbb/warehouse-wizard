-- Pallet Pack Standards — Phase 1: carry the built height across a pallet clone.
--
-- `complete_inventory_pallet_correction` is the one RPC that clones a pallet
-- row. Before this migration the clone copied `length` / `width` / `height` /
-- `weight` only, so a corrected pallet lost the build standard its height rule
-- depends on. It now copies the three `standard_*` snapshot columns as well and
-- keeps the legacy centimetre `height` in step with `standard_height_mm`,
-- exactly as receiving now does.
--
-- The other pallet-lifecycle RPCs were checked and need no change:
--   * `recover_missing_pallet_to_putaway` (20260820010000) updates the pallet
--     in place, so its snapshot columns survive untouched.
--   * `recover_missing_pallet_to_draft` (20260820010000) and the draft helpers
--     in 20260820000000 create receipts, not pallets; the replacement pallet is
--     written by the receiving path, which sets the snapshot itself.
--
-- Replaces the definition in 20260813090000 without editing that file.

create or replace function public.complete_inventory_pallet_correction(
  in_draft_id uuid,
  in_quantity numeric,
  in_expiry_date date,
  in_still_at_former_location boolean
)
returns table(inventory_balance_id uuid, pallet_id uuid, pallet_barcode text, putaway_task_id uuid, putaway_task_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.receipts%rowtype;
  meta jsonb;
  old_pallet public.pallets%rowtype;
  old_balance public.inventory_balances%rowtype;
  old_lot public.inventory_lots%rowtype;
  replacement_lot_id uuid;
  replacement_line_id uuid;
  replacement_pallet_id uuid;
  replacement_balance_id uuid;
  suggested_location_id uuid;
  new_task_id uuid;
  new_task_number text;
  former_location_id uuid;
  profile_row public.product_packaging_profiles%rowtype;
  v_standard_packages_per_layer integer;
  v_standard_layers_per_pallet integer;
  v_standard_height_mm integer;
  v_replacement_height_cm numeric;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Inventory pallet corrections require Receiving permission.';
  end if;
  if coalesce(in_quantity, 0) <= 0 then raise exception 'Quantity per pallet must be greater than zero.'; end if;
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
  select * into old_lot from public.inventory_lots where id = old_pallet.inventory_lot_id;

  -- Carry the pallet's build standard across the clone. A pallet received
  -- before Phase 1 has no snapshot, so fall back to the profile it was built
  -- to rather than losing the height entirely. `height` stays in centimetres
  -- and is kept in step with the millimetre snapshot.
  select * into profile_row from public.product_packaging_profiles where id = old_pallet.packaging_profile_id;
  v_standard_packages_per_layer := coalesce(old_pallet.standard_packages_per_layer, profile_row.packages_per_layer);
  v_standard_layers_per_pallet := coalesce(old_pallet.standard_layers_per_pallet, profile_row.layers_per_pallet);
  v_standard_height_mm := coalesce(old_pallet.standard_height_mm, profile_row.standard_height_mm);
  v_replacement_height_cm := coalesce(v_standard_height_mm / 10.0, old_pallet.height);

  if old_lot.id is not null and old_lot.expiry_date is not distinct from in_expiry_date then
    replacement_lot_id := old_lot.id;
  else
    insert into public.inventory_lots (product_id, client_id, lot_number, batch_number, manufacture_date, loading_date, rotation_date, expiry_date)
    values (old_pallet.product_id, old_pallet.client_id, old_lot.lot_number, old_lot.batch_number, old_lot.manufacture_date, old_lot.loading_date, old_lot.rotation_date, in_expiry_date)
    returning id into replacement_lot_id;
  end if;

  insert into public.receipt_lines (receipt_id, product_id, packaging_profile_id, client_id, quantity, received_quantity, inventory_lot_id, notes)
  values (in_draft_id, old_pallet.product_id, old_pallet.packaging_profile_id, old_pallet.client_id, in_quantity, in_quantity, replacement_lot_id, 'Inventory pallet correction')
  returning id into replacement_line_id;

  insert into public.pallets (
    pallet_code, pallet_barcode, product_id, client_id, receipt_line_id, current_location_id, current_warehouse_id,
    inventory_lot_id, packaging_profile_id, quantity, available_quantity, status, is_stored,
    length, width, height, weight, reused_from_pallet_id,
    standard_packages_per_layer, standard_layers_per_pallet, standard_height_mm
  ) values (
    meta->>'replacement_pallet_barcode', meta->>'replacement_pallet_barcode', old_pallet.product_id, old_pallet.client_id,
    replacement_line_id, case when in_still_at_former_location then former_location_id else null end, old_balance.warehouse_id,
    replacement_lot_id, old_pallet.packaging_profile_id, in_quantity, case when in_still_at_former_location then in_quantity else 0 end,
    case when in_still_at_former_location then 'available'::public.inventory_status else 'receiving'::public.inventory_status end,
    in_still_at_former_location, old_pallet.length, old_pallet.width, v_replacement_height_cm, old_pallet.weight, old_pallet.id,
    v_standard_packages_per_layer, v_standard_layers_per_pallet, v_standard_height_mm
  ) returning id into replacement_pallet_id;

  insert into public.inventory_balances (
    pallet_id, product_id, client_id, warehouse_id, zone_id, location_id, inventory_lot_id, status, quantity, available_quantity, expiry_date
  ) values (
    replacement_pallet_id, old_pallet.product_id, old_pallet.client_id, old_balance.warehouse_id,
    case when in_still_at_former_location then old_balance.zone_id else null end,
    case when in_still_at_former_location then former_location_id else null end,
    replacement_lot_id, case when in_still_at_former_location then 'available'::public.inventory_status else 'receiving'::public.inventory_status end,
    in_quantity, case when in_still_at_former_location then in_quantity else 0 end, in_expiry_date
  ) returning id into replacement_balance_id;

  update public.pallets set correction_state = 'superseded', quantity = 0, available_quantity = 0, current_location_id = null, is_stored = false where id = old_pallet.id;
  update public.inventory_balances set correction_state = 'superseded', quantity = 0, available_quantity = 0, location_id = null, zone_id = null where id = old_balance.id;
  update public.receipts set status = 'completed' where id = in_draft_id;
  insert into public.barcode_labels (label_type, entity_id, label_code, last_printed_at)
  values ('pallet', replacement_pallet_id, meta->>'replacement_pallet_barcode', now());

  if not in_still_at_former_location then
    select location_id into suggested_location_id from public.directed_putaway_candidates(replacement_pallet_id) limit 1;
    new_task_number := public.inventory_correction_code('PTA');
    insert into public.putaway_tasks (task_number, pallet_id, warehouse_id, suggested_location_id, status)
    values (new_task_number, replacement_pallet_id, old_balance.warehouse_id, suggested_location_id, 'queued')
    returning id into new_task_id;
  end if;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, from_location_id, to_location_id, actor_user_id, metadata)
  values ('inventory_pallet_corrected', 'pallets', replacement_pallet_id, old_balance.warehouse_id, replacement_pallet_id,
    former_location_id, case when in_still_at_former_location then former_location_id else null end, auth.uid(),
    jsonb_build_object('draft_id', in_draft_id, 'superseded_pallet_id', old_pallet.id, 'quantity', in_quantity,
      'expiry_date', in_expiry_date, 'still_at_former_location', in_still_at_former_location, 'putaway_task_id', new_task_id));

  return query select replacement_balance_id, replacement_pallet_id, meta->>'replacement_pallet_barcode', new_task_id, new_task_number;
end;
$$;

revoke all on function public.complete_inventory_pallet_correction(uuid, numeric, date, boolean) from public, anon;
grant execute on function public.complete_inventory_pallet_correction(uuid, numeric, date, boolean) to authenticated;