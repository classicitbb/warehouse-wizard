-- NetSuite outbound inventory sync trigger.
--
-- Fires only on the receiving -> available transition of an inventory_balances
-- row (i.e. putaway completed for that pallet/location), per the confirmed
-- design: sync when stock is genuinely available, not at initial receiving
-- scan-in. Does NOT fire on later picks/transfers/adjustments that also touch
-- available_quantity — those are explicitly out of scope for now and would
-- need their own enqueue points once that business logic is designed.
--
-- Skips silently (no-op) whenever:
--   - no enabled NetSuite connection exists
--   - the product has no external_record_links mapping to a NetSuite item
--   - the warehouse has no external_record_links mapping to a NetSuite location
--   - available_quantity is null/zero
-- This makes it safe to ship even for clients with no NetSuite connection at all.

create or replace function public.enqueue_netsuite_inventory_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection_id uuid;
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

  select id into v_connection_id
    from public.integration_connections
   where system = 'netsuite' and enabled = true
   limit 1;
  if v_connection_id is null then
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
      'locationExternalId', v_netsuite_location_id,
      'quantityDelta', new.available_quantity,
      'memo', 'WW putaway completed for balance ' || new.id::text
    )
  )
  on conflict (connection_id, idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_netsuite_inventory_sync on public.inventory_balances;
create trigger trg_enqueue_netsuite_inventory_sync
  after insert or update of available_quantity, status on public.inventory_balances
  for each row execute function public.enqueue_netsuite_inventory_sync();

revoke all on function public.enqueue_netsuite_inventory_sync() from public, anon, authenticated;
