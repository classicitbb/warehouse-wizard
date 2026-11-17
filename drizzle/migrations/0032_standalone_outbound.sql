-- Standalone outbound: orders, trips and customers without NetSuite.
--
-- Until now Orders, Trips and Customers only held what the NetSuite polls
-- mirrored, so an install without NetSuite had no outbound flow beyond ad-hoc
-- pick lists. This adds a WW source next to the NetSuite one. The floor flow
-- (start_fulfillment_pick, confirm_trip_pick, pack check, stage, load scan,
-- depart) is unchanged and runs on both.
--
--   orders.source        'ww'  = entered on the Orders page (sales orders).
--                        'manual' stays the ad-hoc pick list orders.
--   order_fulfillments   source 'ww' = a trip planned in WW. external_record_id
--                        is 'ww:<uuid>' and document_number 'WF-000001', so the
--                        NetSuite poll (which matches on numeric internal ids
--                        and source = 'netsuite') never touches them.
--   customers.source     'ww' = made in WW. The netsuite-customers poll does
--                        not set source, so its rows keep the 'netsuite'
--                        default.
--
-- WW orders reuse the NetSuite status letters so the inbox, trip board and
-- replenishment demand work without change: order B open, D partly shipped,
-- H closed, C cancelled; fulfillment A planned, C shipped. WW has no
-- commitment step, so committed_quantity = quantity.
--
-- With NetSuite: NetSuite stays the system of record. New WW orders and WW
-- customers are refused while netsuite_integration_active() is true; WW
-- records made before the switch-on still finish. When such a WW fulfillment
-- departs and the NetSuite connection is enabled, WW queues a negative
-- inventory_adjustment per picked line (item and location must be linked), so
-- NetSuite on-hand drops with the stock that left. NetSuite fulfillments
-- still post only through the fulfillment_ship job.
--
-- Also: kick_netsuite_queue() now reads only the NetSuite connection.
--
-- Additive only.

-- ============================================================
-- Source columns
-- ============================================================
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check (source in ('manual', 'netsuite', 'ww'));
comment on column public.orders.source is 'manual = ad-hoc pick list order; ww = sales order entered on the Orders page; netsuite = mirrored by netsuite-orders.';

alter table public.order_fulfillments
  add column if not exists source text not null default 'netsuite';
alter table public.order_fulfillments drop constraint if exists order_fulfillments_source_check;
alter table public.order_fulfillments add constraint order_fulfillments_source_check check (source in ('netsuite', 'ww'));
comment on column public.order_fulfillments.source is 'netsuite = item fulfillment mirrored by netsuite-orders; ww = trip planned in WW (plan_ww_fulfillment).';

alter table public.customers
  add column if not exists source text not null default 'netsuite';
alter table public.customers drop constraint if exists customers_source_check;
alter table public.customers add constraint customers_source_check check (source in ('netsuite', 'ww'));
comment on column public.customers.source is 'netsuite = mirrored by netsuite-customers (edit in NetSuite); ww = made and edited in WW.';

create sequence if not exists public.ww_order_number_seq;
create sequence if not exists public.ww_fulfillment_number_seq;
create sequence if not exists public.ww_customer_number_seq;

-- ============================================================
-- Customers made in WW
-- ============================================================
-- p_id null = new. Fields: customer_number (blank = next WC-number), name,
-- delivery_zone, email, phone, ship_address (jsonb: addr1, city, ...),
-- on_credit_hold, credit_review_required, ship_complete, active.
create or replace function public.save_ww_customer(p_id uuid, p_fields jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_number text := nullif(trim(coalesce(p_fields->>'customer_number', '')), '');
  v_name text := nullif(trim(coalesce(p_fields->>'name', '')), '');
  v_source text;
begin
  if auth.uid() is null or not public.is_approved() or not public.has_min_role(auth.uid(), 'warehouse_manager') then
    raise exception 'Only a warehouse manager can edit customers.';
  end if;
  if v_name is null then raise exception 'Enter the customer name.'; end if;

  if v_id is null then
    if public.netsuite_integration_active() then
      raise exception 'NetSuite is connected. Add the customer in NetSuite; it arrives on the next sync.';
    end if;
    if v_number is null then
      loop
        v_number := 'WC-' || lpad(nextval('public.ww_customer_number_seq')::text, 6, '0');
        exit when not exists (select 1 from public.customers where upper(customer_number) = upper(v_number));
      end loop;
    elsif exists (select 1 from public.customers where upper(customer_number) = upper(v_number)) then
      raise exception 'Customer number % is already used.', v_number;
    end if;
    insert into public.customers (customer_number, name, delivery_zone, email, phone, default_ship_address,
      on_credit_hold, credit_review_required, ship_complete, active, source)
    values (v_number, v_name,
      nullif(trim(coalesce(p_fields->>'delivery_zone', '')), ''),
      nullif(trim(coalesce(p_fields->>'email', '')), ''),
      nullif(trim(coalesce(p_fields->>'phone', '')), ''),
      case when jsonb_typeof(p_fields->'ship_address') = 'object' then p_fields->'ship_address' end,
      coalesce((p_fields->>'on_credit_hold')::boolean, false),
      coalesce((p_fields->>'credit_review_required')::boolean, false),
      coalesce((p_fields->>'ship_complete')::boolean, false),
      true, 'ww')
    returning id into v_id;
  else
    select source into v_source from public.customers where id = v_id for update;
    if not found then raise exception 'Customer not found. Refresh the list.'; end if;
    if v_source <> 'ww' then raise exception 'This customer comes from NetSuite. Edit it in NetSuite.'; end if;
    if v_number is not null and exists (select 1 from public.customers where upper(customer_number) = upper(v_number) and id <> v_id) then
      raise exception 'Customer number % is already used.', v_number;
    end if;
    update public.customers set
      customer_number = coalesce(v_number, customer_number),
      name = v_name,
      delivery_zone = nullif(trim(coalesce(p_fields->>'delivery_zone', '')), ''),
      email = nullif(trim(coalesce(p_fields->>'email', '')), ''),
      phone = nullif(trim(coalesce(p_fields->>'phone', '')), ''),
      default_ship_address = case when jsonb_typeof(p_fields->'ship_address') = 'object' then p_fields->'ship_address' end,
      on_credit_hold = coalesce((p_fields->>'on_credit_hold')::boolean, on_credit_hold),
      credit_review_required = coalesce((p_fields->>'credit_review_required')::boolean, credit_review_required),
      ship_complete = coalesce((p_fields->>'ship_complete')::boolean, ship_complete),
      active = coalesce((p_fields->>'active')::boolean, active)
    where id = v_id;
  end if;

  insert into public.audit_events (event_type, entity_table, entity_id, actor_user_id, metadata)
  values (case when p_id is null then 'customer_created' else 'customer_updated' end, 'customers', v_id, auth.uid(),
    jsonb_build_object('customer_number', v_number, 'name', v_name));
  return v_id;
end;
$$;

-- ============================================================
-- Sales orders entered in WW
-- ============================================================
-- p_lines: [{ "product_id": uuid, "quantity": number }] in base units.
create or replace function public.create_ww_order(
  p_warehouse_id uuid,
  p_customer_id uuid,
  p_requested_ship_date date,
  p_customer_reference text,
  p_notes text,
  p_lines jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_order uuid;
  v_number text;
  v_ship_complete boolean := false;
  v_customer_name text;
  line jsonb;
  v_n int := 0;
  v_qty numeric;
  v_product uuid;
begin
  if auth.uid() is null or not public.is_approved() or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Not authorized to enter orders.';
  end if;
  if not public.can_access_warehouse(p_warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;
  if public.netsuite_integration_active() then
    raise exception 'NetSuite is connected. Enter the sales order in NetSuite; it arrives on the next sync.';
  end if;
  if p_customer_id is null then raise exception 'Choose the customer.'; end if;
  select name, ship_complete into v_customer_name, v_ship_complete from public.customers where id = p_customer_id and active;
  if not found then raise exception 'Customer not found or inactive.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line.';
  end if;

  loop
    v_number := 'WO-' || lpad(nextval('public.ww_order_number_seq')::text, 6, '0');
    exit when not exists (select 1 from public.orders where order_number = v_number);
  end loop;

  insert into public.orders (order_number, order_type, warehouse_id, status, requested_ship_date, notes, created_by,
    source, external_status, order_date, customer_id, customer_name, customer_reference, ship_complete)
  values (v_number, 'sales', p_warehouse_id, 'queued', p_requested_ship_date, nullif(trim(coalesce(p_notes, '')), ''), auth.uid(),
    'ww', 'B', current_date, p_customer_id, v_customer_name, nullif(trim(coalesce(p_customer_reference, '')), ''), coalesce(v_ship_complete, false))
  returning id into v_order;

  for line in select * from jsonb_array_elements(p_lines) loop
    v_product := nullif(line->>'product_id', '')::uuid;
    v_qty := coalesce((line->>'quantity')::numeric, 0);
    if v_product is null or not exists (select 1 from public.products where id = v_product) then
      raise exception 'Line % has no product.', v_n + 1;
    end if;
    if v_qty <= 0 then raise exception 'Line % needs a quantity above 0.', v_n + 1; end if;
    v_n := v_n + 1;
    insert into public.order_lines (order_id, product_id, quantity, committed_quantity, line_number, created_by)
    values (v_order, v_product, v_qty, v_qty, v_n, auth.uid());
  end loop;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, actor_user_id, metadata)
  values ('ww_order_created', 'orders', v_order, p_warehouse_id, auth.uid(),
    jsonb_build_object('order_number', v_number, 'customer_id', p_customer_id, 'lines', v_n));
  return v_order;
end;
$$;

-- Cancel a WW order with no open trip. Lines already shipped stay shipped.
create or replace function public.cancel_ww_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  ord public.orders%rowtype;
begin
  if auth.uid() is null or not public.is_approved() or not public.has_min_role(auth.uid(), 'warehouse_supervisor') then
    raise exception 'A supervisor must cancel an order.';
  end if;
  select * into ord from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.can_access_warehouse(ord.warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;
  if ord.source <> 'ww' then raise exception 'Order % comes from NetSuite. Close it in NetSuite.', ord.order_number; end if;
  if ord.external_status in ('C', 'H') then raise exception 'Order % is already closed.', ord.order_number; end if;
  if exists (select 1 from public.order_fulfillments where order_id = ord.id and external_status in ('A', 'B')) then
    raise exception 'Order % is on a trip. Remove it from the trip first.', ord.order_number;
  end if;
  update public.orders set external_status = case when exists (
      select 1 from public.order_lines where order_id = ord.id and fulfilled_quantity > 0) then 'H' else 'C' end,
    status = 'cancelled'
  where id = ord.id;
  update public.order_lines set is_closed = true where order_id = ord.id;
  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, actor_user_id, metadata)
  values ('ww_order_cancelled', 'orders', ord.id, ord.warehouse_id, auth.uid(), jsonb_build_object('order_number', ord.order_number));
end;
$$;

-- ============================================================
-- Trips planned in WW
-- ============================================================
-- Puts the open quantity of a WW order on a trip (date + truck + trip number,
-- as O3). p_lines null = every line's open quantity; else
-- [{ "order_line_id": uuid, "quantity": number }]. Open quantity = ordered -
-- shipped - already on an open WW fulfillment.
create or replace function public.plan_ww_fulfillment(
  p_order_id uuid,
  p_fulfillment_date date,
  p_truck_name text,
  p_trip_number text,
  p_picker_name text,
  p_lines jsonb default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  ord public.orders%rowtype;
  v_id uuid := gen_random_uuid();
  v_doc text;
  v_truck text := nullif(trim(coalesce(p_truck_name, '')), '');
  v_trip text := nullif(trim(coalesce(p_trip_number, '')), '');
  v_picker text := nullif(trim(coalesce(p_picker_name, '')), '');
  line record;
  v_want numeric;
  v_count int := 0;
begin
  if auth.uid() is null or not public.is_approved() or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Not authorized to plan trips.';
  end if;
  select * into ord from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.can_access_warehouse(ord.warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;
  if ord.source <> 'ww' then raise exception 'Order % comes from NetSuite. Plan it on the NetSuite Fulfill Orders page.', ord.order_number; end if;
  if ord.external_status not in ('B', 'D') then raise exception 'Order % is closed.', ord.order_number; end if;
  if p_fulfillment_date is null then raise exception 'Choose the trip date.'; end if;
  if v_truck is null then raise exception 'Enter the truck.'; end if;

  loop
    v_doc := 'WF-' || lpad(nextval('public.ww_fulfillment_number_seq')::text, 6, '0');
    exit when not exists (select 1 from public.order_fulfillments where document_number = v_doc);
  end loop;

  insert into public.order_fulfillments (id, order_id, warehouse_id, external_record_id, document_number, external_status,
    fulfillment_date, truck_name, trip_number, picker_name, source)
  values (v_id, ord.id, ord.warehouse_id, 'ww:' || v_id::text, v_doc, 'A',
    p_fulfillment_date, v_truck, v_trip, v_picker, 'ww');

  for line in
    select ol.id, ol.product_id, ol.line_number,
      greatest(ol.quantity - ol.fulfilled_quantity - coalesce((
        select sum(ofl.quantity) from public.order_fulfillment_lines ofl
        join public.order_fulfillments f on f.id = ofl.fulfillment_id
        where ofl.order_line_id = ol.id and f.external_status in ('A', 'B') and f.id <> v_id
      ), 0), 0) as open_qty
    from public.order_lines ol
    where ol.order_id = ord.id and not ol.is_closed
    order by ol.line_number
  loop
    if p_lines is null then
      v_want := line.open_qty;
    else
      select coalesce(sum((x->>'quantity')::numeric), 0) into v_want
      from jsonb_array_elements(p_lines) x where (x->>'order_line_id')::uuid = line.id;
      if v_want > line.open_qty then
        raise exception 'Line % has only % open.', line.line_number, line.open_qty;
      end if;
    end if;
    if v_want > 0 then
      insert into public.order_fulfillment_lines (fulfillment_id, order_line_id, external_line_id, product_id, quantity)
      values (v_id, line.id, lpad(coalesce(line.line_number, 0)::text, 5, '0'), line.product_id, v_want);
      v_count := v_count + 1;
    end if;
  end loop;

  if v_count = 0 then raise exception 'Nothing open to plan on order %.', ord.order_number; end if;

  update public.orders set truck_name = v_truck, trip_number = v_trip, picker_name = v_picker, status = 'in_progress' where id = ord.id;
  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, actor_user_id, metadata)
  values ('ww_trip_planned', 'order_fulfillments', v_id, ord.warehouse_id, auth.uid(),
    jsonb_build_object('order_number', ord.order_number, 'document_number', v_doc, 'date', p_fulfillment_date, 'truck', v_truck, 'trip_number', v_trip));
  return v_id;
end;
$$;

-- Takes a WW fulfillment off its trip. Refused once anything is picked.
create or replace function public.cancel_ww_fulfillment(p_fulfillment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  ful public.order_fulfillments%rowtype;
  v_list uuid;
begin
  if auth.uid() is null or not public.is_approved() or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Not authorized to change trips.';
  end if;
  select * into ful from public.order_fulfillments where id = p_fulfillment_id for update;
  if not found then raise exception 'Fulfillment not found.'; end if;
  if not public.can_access_warehouse(ful.warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;
  if ful.source <> 'ww' then raise exception '% comes from NetSuite. Delete it in NetSuite.', ful.document_number; end if;
  if ful.external_status not in ('A', 'B') or ful.ww_stage is not null then
    raise exception '% has left the pick. It cannot be removed from the trip.', ful.document_number;
  end if;
  select id into v_list from public.pick_lists where fulfillment_id = ful.id;
  if v_list is not null then
    if exists (select 1 from public.pick_tasks where pick_list_id = v_list and confirmed_quantity > 0) then
      raise exception '% has picked stock. Finish it, or put the stock back with a move first.', ful.document_number;
    end if;
    update public.pick_tasks set status = 'cancelled', short_reason = 'Removed from the trip.'
    where pick_list_id = v_list and status not in ('completed', 'cancelled');
    update public.pick_lists set status = 'cancelled', fulfillment_id = null where id = v_list;
  end if;
  delete from public.order_fulfillments where id = ful.id;
  update public.orders set status = 'queued' where id = ful.order_id
    and not exists (select 1 from public.order_fulfillments where order_id = ful.order_id and external_status in ('A', 'B'));
  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, actor_user_id, metadata)
  values ('ww_trip_removed', 'order_fulfillments', ful.id, ful.warehouse_id, auth.uid(),
    jsonb_build_object('document_number', ful.document_number, 'order_id', ful.order_id));
end;
$$;

-- ============================================================
-- Depart: NetSuite fulfillments queue Shipped; WW fulfillments ship in WW
-- ============================================================
create or replace function public.depart_trip(p_fulfillment_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_keys int;
  v_warehouse uuid;
  v_waiting text;
  v_short boolean;
  v_connection uuid;
  v_post boolean := false;
  v_location text;
  v_job uuid;
  v_departed int := 0;
  v_queued int := 0;
  v_ww int := 0;
  v_netsuite int := 0;
  v_orders uuid[] := '{}';
  ful record;
  ln record;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'Not authorized'; end if;
  if coalesce(array_length(p_fulfillment_ids, 1), 0) = 0 then raise exception 'No orders on this trip.'; end if;

  select count(distinct concat_ws('|', f.warehouse_id, f.fulfillment_date, coalesce(f.truck_external_id, f.truck_name), f.trip_number)), min(f.warehouse_id::text)::uuid
    into v_keys, v_warehouse
  from public.order_fulfillments f where f.id = any(p_fulfillment_ids);
  if v_keys <> 1 then raise exception 'These orders are not one trip. Refresh the trip board.'; end if;
  if not public.can_access_warehouse(v_warehouse) then raise exception 'Not authorized for this warehouse'; end if;

  perform pg_advisory_xact_lock(hashtextextended('trip-depart:' || v_warehouse::text, 0));

  -- Every order with picks must be on the truck. Orders with nothing picked stay behind for the office.
  select string_agg(f.document_number, ', ' order by f.document_number) into v_waiting
  from public.order_fulfillments f
  where f.id = any(p_fulfillment_ids) and f.external_status in ('A', 'B')
    and f.ww_stage is distinct from 'loaded' and f.ww_stage is distinct from 'departed'
    and exists (
      select 1 from public.order_fulfillment_lines ofl
      where ofl.fulfillment_id = f.id and public.fulfillment_line_picked(ofl.id) > 0
    );
  if v_waiting is not null then raise exception 'Load these orders before the trip departs: %.', v_waiting; end if;

  select exists (
    select 1 from public.order_fulfillments f join public.order_fulfillment_lines ofl on ofl.fulfillment_id = f.id
    where f.id = any(p_fulfillment_ids) and f.ww_stage = 'loaded' and public.fulfillment_line_picked(ofl.id) < ofl.quantity
  ) into v_short;
  -- Compare as text: not every database has the warehouse_supervisor enum value.
  if v_short and not exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.code::text in ('admin', 'warehouse_manager', 'warehouse_supervisor', 'developer')
  ) then
    raise exception 'This trip ships short. A supervisor must depart it.';
  end if;

  select id, coalesce(config->>'fulfillments_post_to_netsuite', '') = 'true' into v_connection, v_post
  from public.integration_connections where system = 'netsuite' and enabled = true limit 1;
  select external_id into v_location from public.external_record_links
  where system = 'netsuite' and local_table = 'warehouses' and external_record_type = 'location' and local_id = v_warehouse limit 1;

  for ful in
    select f.* from public.order_fulfillments f
    where f.id = any(p_fulfillment_ids) and f.ww_stage = 'loaded'
    for update
  loop
    v_job := null;
    if ful.source = 'ww' then
      -- Shipped in WW: the picked units leave the order lines.
      for ln in
        select ofl.id, ofl.order_line_id, ofl.product_id, public.fulfillment_line_picked(ofl.id) as picked
        from public.order_fulfillment_lines ofl where ofl.fulfillment_id = ful.id
      loop
        if ln.picked > 0 and ln.order_line_id is not null then
          update public.order_lines set fulfilled_quantity = fulfilled_quantity + ln.picked, picked_quantity = picked_quantity + ln.picked
          where id = ln.order_line_id;
        end if;
        -- A WW order made before NetSuite was switched on: take the stock off NetSuite too.
        if ln.picked > 0 and v_connection is not null and v_location is not null and ln.product_id is not null then
          insert into public.integration_sync_jobs (connection_id, job_type, idempotency_key, payload)
          select v_connection, 'inventory_adjustment', 'ww-ship-' || ln.id::text,
            jsonb_build_object(
              'sku', p.sku,
              'netsuiteItemId', erl.external_id,
              'netsuiteLocationId', v_location,
              'quantityDelta', -ln.picked,
              'memo', 'WW trip shipped ' || ful.document_number
            )
          from public.products p
          join public.external_record_links erl on erl.system = 'netsuite' and erl.local_table = 'products'
            and erl.external_record_type = 'item' and erl.local_id = p.id
          where p.id = ln.product_id
          limit 1
          on conflict (connection_id, idempotency_key) do nothing;
        end if;
      end loop;
      update public.order_fulfillments set
        ww_stage = 'departed', external_status = 'C', departed_at = timezone('utc', now()), departed_by = auth.uid()
      where id = ful.id;
      v_orders := array_append(v_orders, ful.order_id);
      v_ww := v_ww + 1;
    else
      v_netsuite := v_netsuite + 1;
      if v_connection is not null and coalesce(v_post, false) then
        insert into public.integration_sync_jobs (connection_id, job_type, idempotency_key, payload)
        select v_connection, 'fulfillment_ship', 'fulfillment:ship:' || ful.id::text,
          jsonb_strip_nulls(jsonb_build_object(
            'fulfillmentId', ful.external_record_id,
            'documentNumber', ful.document_number,
            'externalRef', 'ww-ship-' || ful.id::text,
            'wwFulfillmentId', ful.id,
            'locationId', v_location,
            'pickedAt', (select max(pt.completed_at) from public.pick_tasks pt join public.pick_lists pl on pl.id = pt.pick_list_id where pl.fulfillment_id = ful.id),
            'packedAt', ful.packed_at,
            'shippedAt', now(), -- timestamptz, so the worker reads it as UTC
            'lines', coalesce((
              select jsonb_agg(jsonb_build_object(
                'line', ofl.external_line_id,
                'itemId', ofl.ns_item_id,
                'unitId', ofl.ns_unit_id,
                'plannedBase', ofl.quantity,
                'pickedBase', public.fulfillment_line_picked(ofl.id),
                -- D9: WW keeps base units; NetSuite takes the line unit.
                'quantity', round(public.fulfillment_line_picked(ofl.id) / coalesce(nullif(u.conversion_rate, 0), 1), 4)
              ) order by ofl.external_line_id)
              from public.order_fulfillment_lines ofl
              left join public.order_lines ol on ol.id = ofl.order_line_id
              left join public.uom_units u on u.id = ol.unit_id
              where ofl.fulfillment_id = ful.id
            ), '[]'::jsonb)
          ))
        on conflict (connection_id, idempotency_key) do nothing
        returning id into v_job;
        if v_job is not null then v_queued := v_queued + 1; end if;
      end if;

      update public.order_fulfillments set
        ww_stage = 'departed', departed_at = timezone('utc', now()), departed_by = auth.uid(),
        ship_sync_job_id = coalesce(v_job, ship_sync_job_id)
      where id = ful.id;
    end if;
    insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, actor_user_id, metadata)
    values ('trip_departed', 'order_fulfillments', ful.id, ful.warehouse_id, auth.uid(),
      jsonb_build_object('document_number', ful.document_number, 'trip_number', ful.trip_number, 'truck', ful.truck_name,
        'ship_short', v_short, 'sync_job_id', v_job, 'source', ful.source));
    v_departed := v_departed + 1;
  end loop;

  if v_departed = 0 then raise exception 'Nothing to depart. This trip has already left.'; end if;

  -- WW orders: closed when every line is shipped, else partly shipped and open for the rest.
  update public.orders o set
    external_status = case when not exists (
        select 1 from public.order_lines ol where ol.order_id = o.id and not ol.is_closed and ol.fulfilled_quantity < ol.quantity
      ) then 'H' else 'D' end,
    status = case when not exists (
        select 1 from public.order_lines ol where ol.order_id = o.id and not ol.is_closed and ol.fulfilled_quantity < ol.quantity
      ) then 'completed'::public.task_status
      when exists (select 1 from public.order_fulfillments f where f.order_id = o.id and f.external_status in ('A', 'B'))
        then 'in_progress'::public.task_status
      else 'queued'::public.task_status end
  where o.id = any(v_orders) and o.source = 'ww';

  return jsonb_build_object('departed', v_departed, 'queued', v_queued, 'posting_enabled', coalesce(v_post, false),
    'ship_short', v_short, 'shipped_in_ww', v_ww, 'netsuite_count', v_netsuite);
end;
$$;

-- ============================================================
-- Views: WW orders in the inbox; source on the trip board
-- ============================================================
create or replace view public.outbound_order_inbox
with (security_invoker = false)
as
select
  o.id,
  o.order_number,
  o.order_type,
  o.warehouse_id,
  w.name as warehouse_name,
  o.external_record_id,
  o.external_status,
  o.order_date,
  o.requested_ship_date,
  o.customer_id,
  coalesce(c.name, o.customer_name) as customer_name,
  c.customer_number,
  c.delivery_zone,
  coalesce(c.on_credit_hold, false) as on_credit_hold,
  coalesce(c.credit_review_required, false) as credit_review_required,
  o.customer_reference,
  o.destination_warehouse_id,
  o.destination_location_name,
  o.truck_name,
  o.trip_number,
  o.picker_name,
  o.picking_ticket_printed,
  o.ship_complete,
  o.unmapped_line_count,
  o.last_synced_at,
  coalesce(l.line_count, 0) as line_count,
  coalesce(l.ordered_quantity, 0) as ordered_quantity,
  coalesce(l.committed_quantity, 0) as committed_quantity,
  coalesce(l.fulfilled_quantity, 0) as fulfilled_quantity,
  coalesce(f.fulfillment_count, 0) as fulfillment_count,
  coalesce(f.open_fulfillment_count, 0) as open_fulfillment_count,
  f.latest_fulfillment_number,
  f.latest_fulfillment_status,
  f.latest_fulfillment_date,
  f.latest_truck_name,
  f.latest_trip_number,
  f.latest_picker_name,
  o.source
from public.orders o
join public.warehouses w on w.id = o.warehouse_id
left join public.customers c on c.id = o.customer_id
left join lateral (
  select
    count(*) as line_count,
    sum(ol.quantity) as ordered_quantity,
    sum(ol.committed_quantity) as committed_quantity,
    sum(ol.fulfilled_quantity) as fulfilled_quantity
  from public.order_lines ol
  where ol.order_id = o.id and not ol.is_closed
) l on true
left join lateral (
  select
    count(*) as fulfillment_count,
    count(*) filter (where ff.external_status <> 'C') as open_fulfillment_count,
    (array_agg(ff.document_number order by ff.fulfillment_date desc nulls last, ff.document_number desc))[1] as latest_fulfillment_number,
    (array_agg(ff.external_status order by ff.fulfillment_date desc nulls last, ff.document_number desc))[1] as latest_fulfillment_status,
    max(ff.fulfillment_date) as latest_fulfillment_date,
    (array_agg(ff.truck_name order by ff.fulfillment_date desc nulls last, ff.document_number desc))[1] as latest_truck_name,
    (array_agg(ff.trip_number order by ff.fulfillment_date desc nulls last, ff.document_number desc))[1] as latest_trip_number,
    (array_agg(ff.picker_name order by ff.fulfillment_date desc nulls last, ff.document_number desc))[1] as latest_picker_name
  from public.order_fulfillments ff
  where ff.order_id = o.id
) f on true
where o.source in ('netsuite', 'ww')
  and public.is_approved()
  and public.can_access_warehouse(o.warehouse_id);

revoke all on public.outbound_order_inbox from anon, public;
grant select on public.outbound_order_inbox to authenticated;

create or replace view public.trip_board
with (security_invoker = true)
as
select
  f.id as fulfillment_id,
  f.warehouse_id,
  w.code as warehouse_code,
  f.document_number,
  f.external_status,
  f.fulfillment_date,
  f.truck_external_id,
  f.truck_name,
  f.trip_number,
  f.picker_name,
  f.order_id,
  o.order_number,
  o.order_type,
  coalesce(c.name, o.customer_name, o.destination_location_name) as customer_name,
  c.delivery_zone,
  coalesce(c.on_credit_hold, false) as on_credit_hold,
  parts.part_number,
  parts.part_count,
  coalesce(l.line_count, 0) as line_count,
  coalesce(l.unmapped_count, 0) as unmapped_count,
  coalesce(l.quantity, 0) as quantity,
  pl.id as pick_list_id,
  pl.status as pick_list_status,
  coalesce(pk.picked_quantity, 0) as picked_quantity,
  coalesce(pk.open_tasks, 0) as open_tasks,
  coalesce(pk.short_tasks, 0) as short_tasks,
  coalesce(pk.exception_tasks, 0) as exception_tasks,
  coalesce(f.fulfillment_date, f.created_at::date) < current_date - w.replen_demand_max_age_days as is_aged,
  f.ww_stage,
  sl.code as staging_lane,
  f.departed_at,
  sj.status as ship_sync_status,
  sj.error_message as ship_sync_error,
  f.source
from public.order_fulfillments f
join public.warehouses w on w.id = f.warehouse_id
join public.orders o on o.id = f.order_id
left join public.customers c on c.id = o.customer_id
left join public.locations sl on sl.id = f.staging_location_id
left join public.integration_sync_jobs sj on sj.id = f.ship_sync_job_id
left join lateral (
  select
    count(*) as line_count,
    count(*) filter (where ofl.product_id is null) as unmapped_count,
    sum(ofl.quantity) as quantity
  from public.order_fulfillment_lines ofl
  where ofl.fulfillment_id = f.id
) l on true
left join lateral (
  select
    (select count(*) from public.order_fulfillments x
      where x.order_id = f.order_id
        and (coalesce(x.fulfillment_date, date '1900-01-01'), x.document_number)
            <= (coalesce(f.fulfillment_date, date '1900-01-01'), f.document_number)) as part_number,
    (select count(*) from public.order_fulfillments x where x.order_id = f.order_id) as part_count
) parts on true
left join public.pick_lists pl on pl.fulfillment_id = f.id
left join lateral (
  select
    sum(pt.confirmed_quantity) filter (where pt.status in ('in_progress', 'completed')) as picked_quantity,
    count(*) filter (where pt.status in ('queued', 'assigned', 'in_progress')) as open_tasks,
    count(*) filter (where pt.status = 'completed' and pt.confirmed_quantity < pt.requested_quantity) as short_tasks,
    count(*) filter (where pt.status = 'exception') as exception_tasks
  from public.pick_tasks pt
  where pt.pick_list_id = pl.id
) pk on pl.id is not null
-- A departed NetSuite fulfillment stays until NetSuite shows Shipped, so a failed post is visible.
-- A WW fulfillment is Shipped (C) when it departs.
where f.external_status in ('A', 'B');

grant select on public.trip_board to authenticated;

-- ============================================================
-- Queue kick: read the NetSuite connection only
-- ============================================================
create or replace function public.kick_netsuite_queue()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_conn uuid; v_url text; v_secret text;
begin
  if not exists (
    select 1 from new_jobs
    where status = 'queued'
      and job_type in ('inventory_adjustment', 'receipt_purchase_order', 'receipt_inbound_shipment', 'fulfillment_ship')
  ) then return null; end if;
  select id into v_conn from integration_connections where system = 'netsuite' and enabled = true order by created_at limit 1;
  if v_conn is null then return null; end if;
  select secret_value into v_url from integration_secrets where connection_id = v_conn and secret_type = 'live_sync_function_url';
  select secret_value into v_secret from integration_secrets where connection_id = v_conn and secret_type = 'netsuite_queue_runner_secret';
  if v_url is null or v_secret is null then return null; end if;
  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-queue-secret', v_secret),
      body := '{"trigger":"live"}'::jsonb,
      timeout_milliseconds := 120000
    );
  exception when others then null;
  end;
  return null;
end; $$;

-- ============================================================
-- Grants
-- ============================================================
revoke all on function public.save_ww_customer(uuid, jsonb) from public, anon;
revoke all on function public.create_ww_order(uuid, uuid, date, text, text, jsonb) from public, anon;
revoke all on function public.cancel_ww_order(uuid) from public, anon;
revoke all on function public.plan_ww_fulfillment(uuid, date, text, text, text, jsonb) from public, anon;
revoke all on function public.cancel_ww_fulfillment(uuid) from public, anon;
revoke all on function public.depart_trip(uuid[]) from public, anon;
grant execute on function public.save_ww_customer(uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_ww_order(uuid, uuid, date, text, text, jsonb) to authenticated, service_role;
grant execute on function public.cancel_ww_order(uuid) to authenticated, service_role;
grant execute on function public.plan_ww_fulfillment(uuid, date, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.cancel_ww_fulfillment(uuid) to authenticated, service_role;
grant execute on function public.depart_trip(uuid[]) to authenticated, service_role;
