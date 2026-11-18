-- Stop queuing a purchase order receipt job for inbound shipment receipts.
--
-- enqueue_netsuite_po_receipt() (trigger trg_enqueue_netsuite_po_receipt on
-- receipts) was created outside the migration history. It queued a
-- `receipt_purchase_order` job for any completed receipt whose draft ref has a
-- poId. Inbound shipment refs carry a poId too, so every shipment pallet was
-- queued twice: once by enqueue_netsuite_inbound_receipt() and once here, with
-- different externalRefs, which would receive the goods twice in NetSuite.
-- Recorded here as it runs live, plus the guard: a ref with inboundShipmentId
-- belongs to enqueue_netsuite_inbound_receipt() alone.

create or replace function public.enqueue_netsuite_po_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection_id uuid; v_meta jsonb; v_ns jsonb; v_item_id text; v_location_id text; v_qty numeric; v_product_id uuid;
begin
  if new.status is distinct from 'completed' or old.status = 'completed' then return new; end if;
  select id into v_connection_id from public.integration_connections
   where system = 'netsuite' and enabled = true and coalesce(config->>'receipts_post_to_netsuite','') = 'true' limit 1;
  if v_connection_id is null then return new; end if;
  begin v_meta := new.notes::jsonb; exception when others then return new; end;
  if jsonb_typeof(v_meta) <> 'object' or jsonb_typeof(v_meta->'netsuite') <> 'object' then return new; end if;
  v_ns := v_meta->'netsuite';
  if coalesce(v_ns->>'poId','') = '' or coalesce(v_ns->>'lineNumber','') = '' then return new; end if;
  -- Inbound shipment lines are received through the shipment job only.
  if coalesce(v_ns->>'inboundShipmentId','') <> '' then return new; end if;
  select coalesce(sum(coalesce(received_quantity, quantity)),0), min(product_id::text)::uuid into v_qty, v_product_id
    from public.receipt_lines where receipt_id = new.id;
  if v_qty is null or v_qty <= 0 then return new; end if;
  select external_id into v_item_id from public.external_record_links
   where system='netsuite' and local_table='products' and local_id=v_product_id and external_record_type='item' limit 1;
  select external_id into v_location_id from public.external_record_links
   where system='netsuite' and local_table='warehouses' and local_id=new.warehouse_id and external_record_type='location' limit 1;
  insert into public.integration_sync_jobs (connection_id, job_type, idempotency_key, payload)
  values (v_connection_id, 'receipt_purchase_order', 'receipt:purchase_order:' || new.id::text,
    jsonb_build_object('documentType','purchase_order','documentId',v_ns->>'poId','poNumber',v_ns->>'poNumber',
      'externalRef', left('ww-rcpt-po-' || new.id::text, 64),'locationId',v_location_id,'receiptId',new.id,
      'lines', jsonb_build_array(jsonb_build_object('lineKey',v_ns->>'lineKey','lineNumber',(v_ns->>'lineNumber')::int,'itemId',v_item_id,'quantity',v_qty))))
  on conflict (connection_id, idempotency_key) do nothing;
  return new;
end; $$;

-- The trigger itself already exists live and is left as it is.

