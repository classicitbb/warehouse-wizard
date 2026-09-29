create or replace function public.confirm_receiving_draft_labels_printed(in_draft_id uuid)
returns table (pallet_id uuid, pallet_barcode text, putaway_task_id uuid, putaway_task_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_row public.receipts%rowtype;
  receipt_meta jsonb;
  product_row public.products%rowtype;
  packaging_row public.product_packaging_profiles%rowtype;
  lot_row public.inventory_lots%rowtype;
  pallet_row public.pallets%rowtype;
  balance_row public.inventory_balances%rowtype;
  existing_task public.putaway_tasks%rowtype;
  receipt_line_id uuid;
  suggested_location_id uuid;
  v_product_id uuid;
  v_client_id uuid;
  v_lot_id uuid;
  v_pallet_id uuid;
  v_quantity numeric;
  v_barcode text;
  v_reuse_barcode text;
  v_returned_pallet_id uuid;
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

  if nullif(receipt_meta->>'inventory_lot_id', '') is not null then
    select * into lot_row from public.inventory_lots
      where id = (receipt_meta->>'inventory_lot_id')::uuid for update;
  else
    select * into lot_row from public.inventory_lots
      where product_id = v_product_id
        and client_id is not distinct from v_client_id
        and lot_number is not distinct from nullif(receipt_meta->>'lot_number', '')
        and batch_number is not distinct from nullif(receipt_meta->>'batch_number', '')
      limit 1 for update;
  end if;
  v_lot_found := found;
  if not v_lot_found then
    insert into public.inventory_lots (
      product_id, client_id, lot_number, batch_number, manufacture_date, expiry_date, loading_date
    ) values (
      v_product_id, v_client_id, nullif(receipt_meta->>'lot_number', ''), nullif(receipt_meta->>'batch_number', ''),
      nullif(receipt_meta->>'manufacture_date', '')::date, nullif(receipt_meta->>'expiry_date', '')::date,
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
        packaging_profile_id, quantity, available_quantity, status, is_stored, length, width, height, weight
      ) values (
        v_barcode, v_barcode, v_product_id, v_client_id, receipt_row.warehouse_id, v_lot_id,
        packaging_row.id, v_quantity, 0, 'receiving', false,
        coalesce(nullif(receipt_meta->>'override_length', '')::numeric, packaging_row.length, product_row.length),
        coalesce(nullif(receipt_meta->>'override_width', '')::numeric, packaging_row.width, product_row.width),
        coalesce(nullif(receipt_meta->>'override_height', '')::numeric, packaging_row.height, product_row.height),
        coalesce(nullif(receipt_meta->>'override_weight', '')::numeric, packaging_row.weight, product_row.weight)
      ) returning * into pallet_row;
      v_pallet_id := pallet_row.id;
    end if;
  end if;

  select id into receipt_line_id from public.receipt_lines
    where receipt_id = receipt_row.id and product_id = v_product_id limit 1;
  if receipt_line_id is null then
    insert into public.receipt_lines (
      receipt_id, product_id, packaging_profile_id, client_id, quantity, received_quantity, inventory_lot_id
    ) values (
      receipt_row.id, v_product_id, packaging_row.id, v_client_id, v_quantity, v_quantity, v_lot_id
    ) returning id into receipt_line_id;
  end if;

  update public.pallets set
    pallet_code = v_barcode, pallet_barcode = v_barcode, product_id = v_product_id, client_id = v_client_id,
    receipt_line_id = receipt_line_id, current_warehouse_id = receipt_row.warehouse_id, current_location_id = null,
    inventory_lot_id = v_lot_id, packaging_profile_id = packaging_row.id, quantity = v_quantity,
    available_quantity = 0, status = 'receiving', is_stored = false
  where id = v_pallet_id;

  if balance_row.id is null then
    insert into public.inventory_balances (
      pallet_id, product_id, client_id, warehouse_id, inventory_lot_id, status, quantity, available_quantity, expiry_date
    ) values (v_pallet_id, v_product_id, v_client_id, receipt_row.warehouse_id, v_lot_id, 'receiving', v_quantity, 0, lot_row.expiry_date);
  else
    update public.inventory_balances set
      product_id = v_product_id, client_id = v_client_id, warehouse_id = receipt_row.warehouse_id,
      zone_id = null, location_id = null, inventory_lot_id = v_lot_id, status = 'receiving',
      quantity = v_quantity, available_quantity = 0, expiry_date = lot_row.expiry_date
    where id = balance_row.id;
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
    jsonb_build_object('draft_id', receipt_row.id, 'pallet_barcode', v_barcode, 'quantity', v_quantity, 'putaway_task_id', v_task_id, 'putaway_task_number', v_task_number));

  return query select v_pallet_id, v_barcode, v_task_id, v_task_number;
end;
$$;

create or replace function public.cancel_receiving_draft(in_draft_id uuid, in_reason text default 'Receiving draft cancelled')
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  if v_pallet_id is not null then
    perform 1 from public.pallets where id = v_pallet_id for update;
    if not found then raise exception 'The pallet linked to this returned draft no longer exists.'; end if;
    update public.pallets set status = 'missing', current_location_id = null, is_stored = false, available_quantity = 0 where id = v_pallet_id;
    update public.inventory_balances set status = 'missing', location_id = null, zone_id = null, available_quantity = 0 where pallet_id = v_pallet_id;
  end if;

  update public.receipts set status = 'cancelled' where id = receipt_row.id;
  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, actor_user_id, metadata)
  values ('receiving_draft_cancelled', 'receipts', receipt_row.id, receipt_row.warehouse_id, v_pallet_id, auth.uid(),
    jsonb_build_object('reason', nullif(trim(in_reason), ''), 'retired_linked_pallet', v_pallet_id is not null));
end;
$$;

revoke all on function public.confirm_receiving_draft_labels_printed(uuid) from public, anon;
revoke all on function public.cancel_receiving_draft(uuid, text) from public, anon;
grant execute on function public.confirm_receiving_draft_labels_printed(uuid) to authenticated;
grant execute on function public.cancel_receiving_draft(uuid, text) to authenticated;

create index if not exists idx_inventory_balances_location_status on public.inventory_balances (location_id, status);
create index if not exists idx_inventory_balances_status_available on public.inventory_balances (status, available_quantity);
create index if not exists idx_inventory_balances_product_status on public.inventory_balances (product_id, status);