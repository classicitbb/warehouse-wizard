-- NetSuite outbound inventory sync: carry NetSuite internal ids in the job payload.
--
-- 20260720040000 looked up the item's NetSuite internal id, required it to
-- exist, then discarded it and sent only the SKU, which the worker posted as an
-- item externalId. The item's internal id is what external_record_links holds
-- (the import picker and the inbound webhook both store the record's `id`), and
-- the location mapping in Settings collects the location's internal id. The
-- payload now names both as internal ids. Trigger conditions are unchanged.
--
-- Jobs already queued with the old shape (`sku`, `locationExternalId`) stay
-- valid: process-netsuite-queue resolves the item id from the SKU for them.

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
