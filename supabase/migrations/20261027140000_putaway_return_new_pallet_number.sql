-- Every Put-Away "return to Receiving" now retires the old pallet number and
-- issues a new one, the same rule the Inventory "Edit & return" flow follows.
--
-- Before: return_putaway_to_receiving_draft re-used the SAME pallet row and
-- barcode (returned_pallet_id), and confirm_receiving_draft_labels_printed
-- forced that old barcode back on receipt.  A label printed from the draft
-- therefore matched no pallet ("no record"), Put-Away kept showing the old
-- number, and the old lot (old expiry) was used so an edited expiry was lost.
--
-- Now:
--   * the return mints a new PLT number into the draft and remembers the old
--     pallet (superseded_pallet_id / superseded_pallet_barcode);
--   * the old pallet is held (correction_state = 'pending') until the draft is
--     received, then superseded (qty 0) -- cancelling the draft marks it missing,
--     matching the previous cancel behaviour;
--   * receiving creates a NEW pallet under the new number, links it to the old
--     one via reused_from_pallet_id, and resolves/creates a lot whose expiry
--     matches the draft instead of silently re-using a lot with another expiry.
--
-- The legacy returned_pallet_id path (transfers, unrecorded pallets, missing
-- pallet recovery) is untouched.

create or replace function public.return_putaway_to_receiving_draft(in_task_id uuid)
returns table (draft_id uuid, draft_pallet_barcode text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  task_row public.putaway_tasks%rowtype;
  pallet_row public.pallets%rowtype;
  balance_row public.inventory_balances%rowtype;
  lot_row public.inventory_lots%rowtype;
  existing_draft public.receipts%rowtype;
  v_draft_id uuid;
  v_quantity numeric;
  v_new_barcode text;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Returning Put-Away work to Receiving requires Receiving permission.';
  end if;
  select * into task_row from public.putaway_tasks where id = in_task_id for update;
  if not found then raise exception 'Put-Away task was not found.'; end if;
  if task_row.status = 'completed' then raise exception 'Cannot return a completed Put-Away task.'; end if;
  if task_row.status = 'cancelled' then raise exception 'Put-Away task has already been returned to Receiving.'; end if;
  if not public.can_access_warehouse(task_row.warehouse_id) then raise exception 'You do not have access to this warehouse.'; end if;
  select * into pallet_row from public.pallets where id = task_row.pallet_id for update;
  if not found then raise exception 'Put-Away pallet was not found.'; end if;
  select * into balance_row from public.inventory_balances where pallet_id = pallet_row.id for update;
  v_quantity := coalesce(nullif(balance_row.quantity, 0), nullif(pallet_row.quantity, 0), 0);
  if v_quantity <= 0 then raise exception 'This pallet has no quantity to return to Receiving.'; end if;

  select * into existing_draft from public.receipts
    where warehouse_id = task_row.warehouse_id and status = 'draft' and notes like '%' || in_task_id::text || '%'
    limit 1 for update;
  if found then
    update public.putaway_tasks set status = 'cancelled', completed_at = now()
      where id = task_row.id and status in ('draft', 'queued', 'assigned', 'in_progress', 'exception');
    return query select existing_draft.id, existing_draft.draft_pallet_barcode;
    return;
  end if;

  if pallet_row.correction_state is not null or balance_row.correction_state is not null then
    raise exception 'This pallet already has a correction in progress or has been superseded.';
  end if;

  select * into lot_row from public.inventory_lots where id = pallet_row.inventory_lot_id;
  v_new_barcode := public.inventory_correction_code('PLT');

  insert into public.receipts (receipt_number, receipt_type, reference_number, warehouse_id, client_id, status, draft_pallet_barcode, notes)
  values (
    public.inventory_correction_code('RCT'), 'other', v_new_barcode, task_row.warehouse_id, pallet_row.client_id, 'draft', v_new_barcode,
    jsonb_build_object(
      '_draft', true, '_returned', true, 'source_label', 'Put-Away task ' || task_row.task_number,
      'source_type', 'putaway_returned', 'source_id', in_task_id, 'reason', 'Returned to receiving from putaway',
      'draft_pallet_barcode', v_new_barcode,
      'product_id', pallet_row.product_id, 'client_id', pallet_row.client_id, 'quantity', v_quantity,
      'packaging_profile_id', pallet_row.packaging_profile_id,
      'lot_number', lot_row.lot_number, 'batch_number', lot_row.batch_number,
      'manufacture_date', lot_row.manufacture_date, 'loading_date', lot_row.loading_date,
      'expiry_date', lot_row.expiry_date,
      'superseded_pallet_id', pallet_row.id, 'superseded_pallet_barcode', pallet_row.pallet_barcode,
      'returned_to_drafts_at', now()
    )::text
  ) returning id into v_draft_id;

  update public.putaway_tasks set status = 'cancelled', completed_at = now()
    where id = task_row.id and status in ('draft', 'queued', 'assigned', 'in_progress', 'exception');
  update public.pallets set
    status = 'receiving', current_location_id = null, is_stored = false, available_quantity = 0, correction_state = 'pending'
    where id = pallet_row.id;
  update public.inventory_balances set
    status = 'receiving', location_id = null, zone_id = null, available_quantity = 0, correction_state = 'pending'
    where pallet_id = pallet_row.id;
  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, actor_user_id, metadata)
  values ('putaway_reverted_to_draft', 'putaway_tasks', task_row.id, task_row.warehouse_id, pallet_row.id, auth.uid(),
    jsonb_build_object('draft_id', v_draft_id, 'previous_status', task_row.status,
      'superseded_pallet_barcode', pallet_row.pallet_barcode, 'draft_pallet_barcode', v_new_barcode));
  return query select v_draft_id, v_new_barcode;
end;
$$;

create or replace function public.cancel_receiving_draft(in_draft_id uuid, in_reason text default 'Receiving draft cancelled')
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  receipt_row public.receipts%rowtype;
  receipt_meta jsonb;
  v_pallet_id uuid;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Cancelling a Receiving draft requires Receiving permission.';
  end if;
  select * into receipt_row from public.receipts where id = in_draft_id for update;
  if not found or receipt_row.status not in ('draft', 'queued') then raise exception 'This Receiving draft is no longer available.'; end if;
  if not public.can_access_warehouse(receipt_row.warehouse_id) then raise exception 'You do not have access to this warehouse.'; end if;
  receipt_meta := coalesce(nullif(receipt_row.notes, '')::jsonb, '{}'::jsonb);
  v_pallet_id := nullif(receipt_meta->>'returned_pallet_id', '')::uuid;
  -- A Put-Away return holds the old pallet as 'pending' under a brand-new draft number.
  if v_pallet_id is null and receipt_meta->>'source_type' = 'putaway_returned' then
    v_pallet_id := nullif(receipt_meta->>'superseded_pallet_id', '')::uuid;
  end if;

  if v_pallet_id is not null then
    perform 1 from public.pallets where id = v_pallet_id for update;
    if not found then raise exception 'The pallet linked to this returned draft no longer exists.'; end if;
    update public.pallets set status = 'missing', correction_state = null, current_location_id = null, is_stored = false, available_quantity = 0 where id = v_pallet_id;
    update public.inventory_balances set status = 'missing', correction_state = null, location_id = null, zone_id = null, available_quantity = 0 where pallet_id = v_pallet_id;
  end if;

  update public.receipts set status = 'cancelled' where id = receipt_row.id;
  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, actor_user_id, metadata)
  values ('receiving_draft_cancelled', 'receipts', receipt_row.id, receipt_row.warehouse_id, v_pallet_id, auth.uid(),
    jsonb_build_object('reason', nullif(trim(in_reason), ''), 'retired_linked_pallet', v_pallet_id is not null));
end;
$$;

create or replace function public.confirm_receiving_draft_labels_printed(in_draft_id uuid)
returns table (pallet_id uuid, pallet_barcode text, putaway_task_id uuid, putaway_task_number text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  receipt_row public.receipts%rowtype;
  receipt_meta jsonb;
  product_row public.products%rowtype;
  packaging_row public.product_packaging_profiles%rowtype;
  lot_row public.inventory_lots%rowtype;
  pallet_row public.pallets%rowtype;
  balance_row public.inventory_balances%rowtype;
  existing_task public.putaway_tasks%rowtype;
  v_receipt_line_id uuid;
  suggested_location_id uuid;
  v_product_id uuid;
  v_client_id uuid;
  v_lot_id uuid;
  v_pallet_id uuid;
  v_quantity numeric;
  v_barcode text;
  v_reuse_barcode text;
  v_returned_pallet_id uuid;
  v_superseded_id uuid;
  v_has_expiry boolean;
  v_expiry date;
  v_task_id uuid;
  v_task_number text;
  v_lot_found boolean;
  v_pallet_found boolean;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Confirming printed receiving labels requires Receiving permission.';
  end if;

  select * into receipt_row from public.receipts where id = in_draft_id for update;
  if not found or receipt_row.status not in ('draft', 'queued') then
    raise exception 'This Receiving draft is no longer available.';
  end if;
  if not public.can_access_warehouse(receipt_row.warehouse_id) then
    raise exception 'You do not have access to this warehouse.';
  end if;

  receipt_meta := coalesce(nullif(receipt_row.notes, '')::jsonb, '{}'::jsonb);
  v_product_id := nullif(receipt_meta->>'product_id', '')::uuid;
  v_client_id := coalesce(receipt_row.client_id, nullif(receipt_meta->>'client_id', '')::uuid);
  v_quantity := nullif(receipt_meta->>'quantity', '')::numeric;
  v_barcode := coalesce(nullif(receipt_row.draft_pallet_barcode, ''), nullif(receipt_meta->>'draft_pallet_barcode', ''));
  v_returned_pallet_id := nullif(receipt_meta->>'returned_pallet_id', '')::uuid;
  v_superseded_id := nullif(receipt_meta->>'superseded_pallet_id', '')::uuid;
  v_has_expiry := receipt_meta ? 'expiry_date';
  v_expiry := nullif(receipt_meta->>'expiry_date', '')::date;

  if v_product_id is null or v_quantity is null or v_quantity <= 0 or v_barcode is null then
    raise exception 'Receiving draft is missing its pallet details.';
  end if;

  select * into product_row from public.products where id = v_product_id for key share;
  if not found then raise exception 'The draft product no longer exists.'; end if;
  if nullif(receipt_meta->>'packaging_profile_id', '') is not null then
    select * into packaging_row from public.product_packaging_profiles
      where id = (receipt_meta->>'packaging_profile_id')::uuid for key share;
    if not found then raise exception 'The draft packaging profile no longer exists.'; end if;
  end if;

  -- A lot is only re-used when its expiry matches what the draft says.  The
  -- draft may carry the original pallet's lot id, but an edited expiry must not
  -- be silently replaced by the old lot's date (nor rewrite a lot other pallets share).
  v_lot_found := false;
  if nullif(receipt_meta->>'inventory_lot_id', '') is not null then
    select * into lot_row from public.inventory_lots
      where id = (receipt_meta->>'inventory_lot_id')::uuid for update;
    v_lot_found := found;
    if v_lot_found and v_has_expiry and lot_row.expiry_date is distinct from v_expiry then
      v_lot_found := false;
    end if;
  end if;
  if not v_lot_found then
    select * into lot_row from public.inventory_lots
      where product_id = v_product_id
        and client_id is not distinct from v_client_id
        and lot_number is not distinct from nullif(receipt_meta->>'lot_number', '')
        and batch_number is not distinct from nullif(receipt_meta->>'batch_number', '')
        and (not v_has_expiry or expiry_date is not distinct from v_expiry)
      limit 1 for update;
    v_lot_found := found;
  end if;
  if not v_lot_found then
    insert into public.inventory_lots (
      product_id, client_id, lot_number, batch_number, manufacture_date, expiry_date, loading_date
    ) values (
      v_product_id, v_client_id, nullif(receipt_meta->>'lot_number', ''), nullif(receipt_meta->>'batch_number', ''),
      nullif(receipt_meta->>'manufacture_date', '')::date, v_expiry,
      nullif(receipt_meta->>'loading_date', '')::date
    ) returning * into lot_row;
  end if;
  v_lot_id := lot_row.id;

  -- Returned/reconciled drafts retain their physical pallet identity.  Normal
  -- drafts can only reuse a pallet that is genuinely empty.
  if v_returned_pallet_id is not null then
    select * into pallet_row from public.pallets where id = v_returned_pallet_id for update;
    if not found then raise exception 'The pallet linked to this returned draft no longer exists.'; end if;
    select * into balance_row from public.inventory_balances where pallet_id = pallet_row.id for update;
    v_pallet_id := pallet_row.id;
    v_barcode := pallet_row.pallet_barcode;
  else
    v_reuse_barcode := nullif(receipt_meta->>'reuse_pallet_barcode', '');
    if v_reuse_barcode is not null then
      select * into pallet_row from public.pallets
        where pallet_code = v_reuse_barcode or pallet_barcode = v_reuse_barcode for update;
      v_pallet_found := found;
      if v_pallet_found and coalesce(pallet_row.quantity, 0) > 0 then
        raise exception 'Pallet % still has stock and cannot be reused.', v_reuse_barcode;
      end if;
    else
      -- A pallet may already exist for this draft barcode (older queued drafts,
      -- or a retried confirmation).  Reuse it only when it is not yet stored.
      select * into pallet_row from public.pallets
        where (pallet_code = v_barcode or pallet_barcode = v_barcode)
          and coalesce(is_stored, false) = false
        limit 1 for update;
      v_pallet_found := found;
    end if;

    if v_pallet_found then
      v_pallet_id := pallet_row.id;
      v_barcode := pallet_row.pallet_barcode;
      select * into balance_row from public.inventory_balances where pallet_id = v_pallet_id for update;
    else
      insert into public.pallets (
        pallet_code, pallet_barcode, product_id, client_id, current_warehouse_id, inventory_lot_id,
        packaging_profile_id, quantity, available_quantity, status, is_stored, length, width, height, weight,
        reused_from_pallet_id
      ) values (
        v_barcode, v_barcode, v_product_id, v_client_id, receipt_row.warehouse_id, v_lot_id,
        packaging_row.id, v_quantity, 0, 'putaway', false,
        coalesce(nullif(receipt_meta->>'override_length', '')::numeric, packaging_row.length, product_row.length),
        coalesce(nullif(receipt_meta->>'override_width', '')::numeric, packaging_row.width, product_row.width),
        coalesce(nullif(receipt_meta->>'override_height', '')::numeric, packaging_row.height, product_row.height),
        coalesce(nullif(receipt_meta->>'override_weight', '')::numeric, packaging_row.weight, product_row.weight),
        v_superseded_id
      ) returning * into pallet_row;
      v_pallet_id := pallet_row.id;
    end if;
  end if;

  select id into v_receipt_line_id from public.receipt_lines
    where receipt_id = receipt_row.id and product_id = v_product_id limit 1;
  if v_receipt_line_id is null then
    insert into public.receipt_lines (
      receipt_id, product_id, packaging_profile_id, client_id, quantity, received_quantity, inventory_lot_id
    ) values (
      receipt_row.id, v_product_id, packaging_row.id, v_client_id, v_quantity, v_quantity, v_lot_id
    ) returning id into v_receipt_line_id;
  end if;

  update public.pallets set
    pallet_code = v_barcode, pallet_barcode = v_barcode, product_id = v_product_id, client_id = v_client_id,
    receipt_line_id = v_receipt_line_id, current_warehouse_id = receipt_row.warehouse_id, current_location_id = null,
    inventory_lot_id = v_lot_id, packaging_profile_id = packaging_row.id, quantity = v_quantity,
    available_quantity = 0, status = 'putaway', is_stored = false
  where id = v_pallet_id;

  if balance_row.id is null then
    insert into public.inventory_balances (
      pallet_id, product_id, client_id, warehouse_id, inventory_lot_id, status, quantity, available_quantity, expiry_date
    ) values (v_pallet_id, v_product_id, v_client_id, receipt_row.warehouse_id, v_lot_id, 'putaway', v_quantity, 0, lot_row.expiry_date);
  else
    update public.inventory_balances set
      product_id = v_product_id, client_id = v_client_id, warehouse_id = receipt_row.warehouse_id,
      zone_id = null, location_id = null, inventory_lot_id = v_lot_id, status = 'putaway',
      quantity = v_quantity, available_quantity = 0, expiry_date = lot_row.expiry_date
    where id = balance_row.id;
  end if;

  -- The pallet this one replaces is now history: zero stock, no location.
  if v_superseded_id is not null and v_superseded_id is distinct from v_pallet_id then
    update public.pallets set
      correction_state = 'superseded', quantity = 0, available_quantity = 0, current_location_id = null, is_stored = false
      where id = v_superseded_id;
    update public.inventory_balances set
      correction_state = 'superseded', quantity = 0, available_quantity = 0, location_id = null, zone_id = null
      where pallet_id = v_superseded_id;
  end if;

  select * into existing_task from public.putaway_tasks
    where pallet_id = v_pallet_id and status in ('draft', 'queued', 'assigned', 'in_progress', 'exception')
    order by created_at desc limit 1 for update;
  if found then
    v_task_id := existing_task.id;
    v_task_number := existing_task.task_number;
  else
    select location_id into suggested_location_id from public.directed_putaway_candidates(v_pallet_id) limit 1;
    v_task_number := public.inventory_correction_code('PTA');
    insert into public.putaway_tasks (task_number, pallet_id, warehouse_id, suggested_location_id, status)
    values (v_task_number, v_pallet_id, receipt_row.warehouse_id, suggested_location_id, 'queued')
    returning id into v_task_id;
  end if;

  update public.receipts set status = 'completed' where id = receipt_row.id;
  insert into public.barcode_labels (label_type, entity_id, label_code, last_printed_at)
  values ('pallet', v_pallet_id, v_barcode, now());
  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, actor_user_id, metadata)
  values ('receiving_labels_confirmed', 'receipts', receipt_row.id, receipt_row.warehouse_id, v_pallet_id, auth.uid(),
    jsonb_build_object('draft_id', receipt_row.id, 'pallet_barcode', v_barcode, 'quantity', v_quantity,
      'putaway_task_id', v_task_id, 'putaway_task_number', v_task_number,
      'superseded_pallet_id', v_superseded_id, 'superseded_pallet_barcode', receipt_meta->>'superseded_pallet_barcode'));

  return query select v_pallet_id, v_barcode, v_task_id, v_task_number;
end;
$$;

revoke all on function public.return_putaway_to_receiving_draft(uuid) from public, anon;
revoke all on function public.cancel_receiving_draft(uuid, text) from public, anon;
revoke all on function public.confirm_receiving_draft_labels_printed(uuid) from public, anon;
grant execute on function public.return_putaway_to_receiving_draft(uuid) to authenticated;
grant execute on function public.cancel_receiving_draft(uuid, text) to authenticated;
grant execute on function public.confirm_receiving_draft_labels_printed(uuid) to authenticated;
