-- Putaway/receipt double count, and the pallet -> receipt line link it relies on.
--
-- Labels printed (confirm_receiving_draft_labels_printed) completes the receipt
-- and creates the pallet and its inventory record. Putaway only sets the
-- location; that is when the balance becomes 'available' and
-- enqueue_netsuite_inventory_sync posts an inventory adjustment. Once receipts
-- are posted to NetSuite as item receipts (whitepaper W3), the adjustment would
-- add the same goods a second time for anything received against a NetSuite
-- purchase order, transfer order or inbound shipment.
--
-- 1. Link fix. 20260902143104 added `#variable_conflict use_column` to
--    confirm_receiving_draft_labels_printed, which turns its
--    `receipt_line_id = receipt_line_id` assignment into a no-op, so pallets
--    were never linked to their receipt line. Rename the local variable in the
--    live definition (same patch-in-place approach as 20260902143104, so any
--    body changes made outside the repository are kept).
-- 2. Backfill the missing links from the receiving_labels_confirmed audit
--    events, which record both the receipt and the pallet.
-- 3. netsuite_receipt_sourced_pallet(): true when a pallet's receipt was loaded
--    from a NetSuite document (the draft notes carry a `netsuite` line ref).
-- 4. enqueue_netsuite_inventory_sync skips the putaway adjustment for those
--    pallets, but only while the connection's config has
--    `receipts_post_to_netsuite = true`. That key is unset everywhere today, so
--    behaviour does not change until receipt posting (W3) is switched on in the
--    same step.

-- 1. Link fix -----------------------------------------------------------------
DO $do$
DECLARE
  def text;
  patched text;
  pair text[];
  hits int;
BEGIN
  def := pg_get_functiondef('public.confirm_receiving_draft_labels_printed(uuid)'::regprocedure);
  IF position('v_receipt_line_id' in def) > 0 THEN
    RETURN; -- already patched
  END IF;
  patched := def;
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['receipt_line_id uuid;', 'v_receipt_line_id uuid;'],
    ARRAY['select id into receipt_line_id from public.receipt_lines', 'select id into v_receipt_line_id from public.receipt_lines'],
    ARRAY['if receipt_line_id is null then', 'if v_receipt_line_id is null then'],
    ARRAY['returning id into receipt_line_id;', 'returning id into v_receipt_line_id;'],
    ARRAY['receipt_line_id = receipt_line_id,', 'receipt_line_id = v_receipt_line_id,']
  ] LOOP
    hits := (length(patched) - length(replace(patched, pair[1], ''))) / length(pair[1]);
    IF hits <> 1 THEN
      RAISE EXCEPTION 'confirm_receiving_draft_labels_printed: expected one "%" but found %', pair[1], hits;
    END IF;
    patched := replace(patched, pair[1], pair[2]);
  END LOOP;
  EXECUTE patched;
END
$do$;

-- 2. Backfill -----------------------------------------------------------------
-- The latest label confirmation for each pallet wins (a pallet barcode can be
-- reused for a later receipt). Only fills links that are missing.
update public.pallets p
   set receipt_line_id = rl.id
  from (
    select distinct on (ae.pallet_id) ae.pallet_id, ae.entity_id as receipt_id
      from public.audit_events ae
     where ae.event_type = 'receiving_labels_confirmed'
       and ae.entity_table = 'receipts'
       and ae.pallet_id is not null
     order by ae.pallet_id, ae.created_at desc
  ) last_confirm
  cross join lateral (
    select l.id
      from public.receipt_lines l
     where l.receipt_id = last_confirm.receipt_id
     order by l.created_at
     limit 1
  ) rl
 where p.id = last_confirm.pallet_id
   and p.receipt_line_id is null;

-- 3. Was this pallet received against a NetSuite document? ---------------------
create or replace function public.netsuite_receipt_sourced_pallet(p_pallet_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_notes text;
  v_meta jsonb;
begin
  select r.notes into v_notes
    from public.pallets p
    join public.receipt_lines rl on rl.id = p.receipt_line_id
    join public.receipts r on r.id = rl.receipt_id
   where p.id = p_pallet_id;
  if v_notes is null or v_notes = '' then
    return false;
  end if;
  begin
    v_meta := v_notes::jsonb;
  exception when others then
    return false; -- free-text notes on older receipts
  end;
  return jsonb_typeof(v_meta) = 'object' and jsonb_typeof(v_meta->'netsuite') = 'object';
end;
$$;

revoke all on function public.netsuite_receipt_sourced_pallet(uuid) from public, anon, authenticated;
grant execute on function public.netsuite_receipt_sourced_pallet(uuid) to service_role;

-- 4. Putaway adjustment skips NetSuite-sourced receipts once receipts post ------
create or replace function public.enqueue_netsuite_inventory_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection_id uuid;
  v_receipts_post boolean;
  v_netsuite_item_id text;
  v_netsuite_location_id text;
  v_sku text;
begin
  -- Only the moment a row becomes available for the first time.
  if new.status is distinct from 'available' then
    return new;
  end if;
  if TG_OP = 'UPDATE' and old.status = 'available' then
    return new;
  end if;
  if new.available_quantity is null or new.available_quantity = 0 then
    return new;
  end if;

  select id, coalesce(config->>'receipts_post_to_netsuite', '') = 'true'
    into v_connection_id, v_receipts_post
    from public.integration_connections
   where system = 'netsuite' and enabled = true
   limit 1;
  if v_connection_id is null then
    return new;
  end if;

  -- Received against a NetSuite PO, transfer order or inbound shipment: the
  -- item receipt posted at label print already added this stock to NetSuite.
  if v_receipts_post and public.netsuite_receipt_sourced_pallet(new.pallet_id) then
    return new;
  end if;

  select external_id into v_netsuite_item_id
    from public.external_record_links
   where system = 'netsuite'
     and local_table = 'products'
     and local_id = new.product_id
     and external_record_type = 'item'
   limit 1;
  if v_netsuite_item_id is null then
    return new;
  end if;

  select external_id into v_netsuite_location_id
    from public.external_record_links
   where system = 'netsuite'
     and local_table = 'warehouses'
     and local_id = new.warehouse_id
     and external_record_type = 'location'
   limit 1;
  if v_netsuite_location_id is null then
    return new;
  end if;

  select sku into v_sku from public.products where id = new.product_id;
  if v_sku is null then
    return new;
  end if;

  insert into public.integration_sync_jobs (connection_id, job_type, idempotency_key, payload)
  values (
    v_connection_id,
    'inventory_adjustment',
    'putaway-' || new.id::text,
    jsonb_build_object(
      'sku', v_sku,
      'netsuiteItemId', v_netsuite_item_id,
      'netsuiteLocationId', v_netsuite_location_id,
      'quantityDelta', new.available_quantity,
      'memo', 'WW putaway completed for balance ' || new.id::text
    )
  )
  on conflict (connection_id, idempotency_key) do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_netsuite_inventory_sync() from public, anon, authenticated;
grant execute on function public.enqueue_netsuite_inventory_sync() to service_role;
