-- Post inbound shipment receipts to NetSuite (Phase 1, W3c).
--
-- Completing a Receiving draft (labels printed) is the moment the goods are
-- counted, so that is when the item receipt is queued. NetSuite then moves the
-- inbound shipment to Partially received / Received. Put-Away only sets the
-- location and no longer posts an adjustment for these pallets.
--
-- Switched off until the NetSuite connection's config has
-- `receipts_post_to_netsuite = true`: with the key unset this migration queues
-- nothing and the putaway adjustment behaves exactly as before.
--
-- 1. enqueue_netsuite_inbound_receipt(): when a receipt becomes 'completed' and
--    its draft notes carry an inbound shipment line ref (W4), queue one
--    `receipt_inbound_shipment` job. One job per pallet receipt, keyed on the
--    receipt id, so a retried or repeated completion cannot post twice. The
--    RESTlet also dedupes on the same externalRef (`ww-rcpt-ship-<receipt id>`).
--    Best effort: a failure here must never block the floor from printing labels.
-- 2. netsuite_receipt_sourced_pallet() now means "an inbound shipment receipt
--    posts this stock". Purchase order and transfer order refs are not posted yet
--    (W3a/W3b), so skipping their putaway adjustment would lose the stock.

-- 1. Queue the receipt ----------------------------------------------------------
create or replace function public.enqueue_netsuite_inbound_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection_id uuid;
  v_receipts_post boolean;
  v_meta jsonb;
  v_ref jsonb;
  v_shipment text;
  v_line_key text;
  v_quantity numeric;
  v_item_id text;
  v_location_id text;
begin
  if new.status is distinct from 'completed' then
    return new;
  end if;
  if TG_OP = 'UPDATE' and old.status is not distinct from 'completed' then
    return new;
  end if;
  if new.notes is null or new.notes = '' then
    return new;
  end if;

  begin
    v_meta := new.notes::jsonb;
  exception when others then
    return new; -- free-text notes on older receipts
  end;
  if jsonb_typeof(v_meta) is distinct from 'object' or jsonb_typeof(v_meta->'netsuite') is distinct from 'object' then
    return new;
  end if;

  -- A pallet returned to Receiving, or recovered, is stock already received once.
  if v_meta ? 'superseded_pallet_id' or v_meta ? 'returned_pallet_id' then
    return new;
  end if;

  select id, coalesce(config->>'receipts_post_to_netsuite', '') = 'true'
    into v_connection_id, v_receipts_post
    from public.integration_connections
   where system = 'netsuite' and enabled = true
   limit 1;
  if v_connection_id is null or not coalesce(v_receipts_post, false) then
    return new;
  end if;

  v_ref := v_meta->'netsuite';
  v_shipment := nullif(btrim(v_ref->>'inboundShipmentId'), '');
  v_line_key := nullif(btrim(v_ref->>'lineKey'), '');
  v_quantity := nullif(v_meta->>'quantity', '')::numeric;
  if v_shipment is null or v_line_key is null or v_quantity is null or v_quantity <= 0 then
    return new;
  end if;

  select external_id into v_item_id
    from public.external_record_links
   where system = 'netsuite' and local_table = 'products' and external_record_type = 'item'
     and local_id = nullif(v_meta->>'product_id', '')::uuid
   limit 1;
  select external_id into v_location_id
    from public.external_record_links
   where system = 'netsuite' and local_table = 'warehouses' and external_record_type = 'location'
     and local_id = new.warehouse_id
   limit 1;

  insert into public.integration_sync_jobs (connection_id, job_type, idempotency_key, payload)
  values (
    v_connection_id,
    'receipt_inbound_shipment',
    'receipt:inbound_shipment:' || new.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'documentType', 'inbound_shipment',
      'documentId', v_shipment,
      'externalRef', 'ww-rcpt-ship-' || new.id::text,
      'receiptId', new.id,
      'locationId', v_location_id,
      'lines', jsonb_build_array(jsonb_build_object(
        'lineKey', v_line_key,
        'lineNumber', v_ref->'lineNumber',
        'itemId', v_item_id,
        'poId', v_ref->>'poId',
        'quantity', v_quantity,
        'lotNumber', nullif(v_meta->>'lot_number', ''),
        'expiryDate', nullif(v_meta->>'expiry_date', '')
      ))
    ))
  )
  on conflict (connection_id, idempotency_key) do nothing;

  return new;
exception when others then
  raise warning 'enqueue_netsuite_inbound_receipt failed for receipt %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.enqueue_netsuite_inbound_receipt() from public, anon, authenticated;
grant execute on function public.enqueue_netsuite_inbound_receipt() to service_role;

drop trigger if exists trg_enqueue_netsuite_inbound_receipt on public.receipts;
create trigger trg_enqueue_netsuite_inbound_receipt
  after insert or update of status on public.receipts
  for each row
  when (new.status = 'completed')
  execute function public.enqueue_netsuite_inbound_receipt();

-- 2. Only inbound shipment receipts replace the putaway adjustment ---------------
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
  return jsonb_typeof(v_meta) = 'object'
    and jsonb_typeof(v_meta->'netsuite') = 'object'
    and nullif(btrim(v_meta->'netsuite'->>'inboundShipmentId'), '') is not null;
end;
$$;

revoke all on function public.netsuite_receipt_sourced_pallet(uuid) from public, anon, authenticated;
grant execute on function public.netsuite_receipt_sourced_pallet(uuid) to service_role;
