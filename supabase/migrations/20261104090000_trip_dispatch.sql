-- Trip pack check, staging, load scan and departure (outbound picking design,
-- slice F: D3/D10/D11 as changed by O1/O4, N1, T2, roadmap 2.2).
--
-- The floor stage of each office fulfillment goes:
--   picked (slice E) -> packed -> staged -> loaded -> departed
-- and lives in new WW columns on order_fulfillments. The NetSuite poll upserts
-- only the columns it maps, so it never clears these.
--
-- Pack check: the packer scans the item of each picked line and counts it.
-- The count must equal what WW picked for the line; a mismatch is refused, so
-- the packer recounts or the line is re-picked. Lines with nothing picked
-- pass. Stage: the packer scans a staging lane (a bin in an is_staging zone);
-- WW records a staging_loads row for the pick list. Load: at the truck the
-- loader scans the order, the IF number or the pick list number. Depart: when
-- every fulfillment of the trip with picks is loaded, the trip departs.
--
-- Depart is the only NetSuite write (roadmap 2.2: post when it leaves, not at
-- staged; nobody uses Packed, §8.1). WW queues one 'fulfillment_ship' job per
-- fulfillment: shipStatus C, the real pick/pack/ship times (O4, V19), and the
-- picked quantity of each line in the line unit (D9). A line picked short
-- ships short (D10) and the SO stays Partially Fulfilled. A line with
-- nothing picked is sent with itemReceive false. The job is queued only when
-- the connection config has fulfillments_post_to_netsuite = true, the same
-- gate the receipts use. A depart with a short line needs a supervisor.
--
-- A fulfillment with nothing picked cannot be packed or loaded. It stays on
-- the board at Picked, and the office ships or deletes it (V22).
--
-- Additive only.

-- ============================================================
-- Floor stage columns
-- ============================================================
alter table public.order_fulfillments
  add column if not exists ww_stage            text check (ww_stage in ('packed', 'staged', 'loaded', 'departed')),
  add column if not exists packed_at           timestamptz,
  add column if not exists packed_by           uuid references auth.users (id) on delete set null,
  add column if not exists staged_at           timestamptz,
  add column if not exists staging_location_id uuid references public.locations (id) on delete set null,
  add column if not exists loaded_at           timestamptz,
  add column if not exists loaded_by           uuid references auth.users (id) on delete set null,
  add column if not exists departed_at         timestamptz,
  add column if not exists departed_by         uuid references auth.users (id) on delete set null,
  add column if not exists ship_sync_job_id    uuid references public.integration_sync_jobs (id) on delete set null;

comment on column public.order_fulfillments.ww_stage is 'WW floor stage after the pick (slice F): packed, staged, loaded, departed. Null = not packed. NetSuite external_status changes to C only when the fulfillment_ship job posts.';

alter table public.order_fulfillment_lines
  add column if not exists packed_quantity numeric(18,4),
  add column if not exists packed_at       timestamptz;

comment on column public.order_fulfillment_lines.packed_quantity is 'Base units the pack check counted. Equal to what WW picked for the line.';

alter table public.staging_loads
  add column if not exists fulfillment_id uuid references public.order_fulfillments (id) on delete cascade,
  add column if not exists location_id    uuid references public.locations (id) on delete set null;

create unique index if not exists staging_loads_fulfillment_idx
  on public.staging_loads (fulfillment_id) where fulfillment_id is not null;

-- ============================================================
-- Helpers
-- ============================================================
-- Base units WW picked for one fulfillment line.
create or replace function public.fulfillment_line_picked(p_line_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(pt.confirmed_quantity), 0)
  from public.pick_tasks pt
  where pt.fulfillment_line_id = p_line_id and pt.status in ('in_progress', 'completed');
$$;

-- Loads one open fulfillment for a floor step and checks access.
create or replace function public.trip_fulfillment_for_floor(p_fulfillment_id uuid)
returns public.order_fulfillments language plpgsql stable security definer set search_path = public as $$
declare
  ful public.order_fulfillments%rowtype;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'Not authorized'; end if;
  select * into ful from public.order_fulfillments where id = p_fulfillment_id;
  if not found then raise exception 'Fulfillment not found. Refresh the trip board.'; end if;
  if not public.can_access_warehouse(ful.warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;
  if ful.external_status not in ('A', 'B') or ful.ww_stage = 'departed' then
    raise exception 'Fulfillment % has already left.', ful.document_number;
  end if;
  return ful;
end;
$$;

-- ============================================================
-- Pack check: scan the item of a line and count it
-- ============================================================
create or replace function public.confirm_pack_line(p_fulfillment_line_id uuid, p_scan text, p_quantity numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  line public.order_fulfillment_lines%rowtype;
  ful public.order_fulfillments%rowtype;
  prod public.products%rowtype;
  v_scan text := upper(trim(coalesce(p_scan, '')));
  v_picked numeric;
  v_open int;
begin
  select * into line from public.order_fulfillment_lines where id = p_fulfillment_line_id for update;
  if not found then raise exception 'Line not found. Refresh the pack check.'; end if;
  ful := public.trip_fulfillment_for_floor(line.fulfillment_id);
  if ful.ww_stage in ('staged', 'loaded') then raise exception 'Order % is already staged. Its pack check is closed.', ful.document_number; end if;

  if exists (
    select 1 from public.pick_tasks pt join public.pick_lists pl on pl.id = pt.pick_list_id
    where pl.fulfillment_id = ful.id and pt.status not in ('completed', 'cancelled')
  ) or not exists (select 1 from public.pick_lists where fulfillment_id = ful.id) then
    raise exception 'Finish the pick of % first.', ful.document_number;
  end if;

  select * into prod from public.products where id = line.product_id;
  if v_scan = '' then raise exception 'Scan the item.'; end if;
  if not found or (upper(prod.sku) <> v_scan and upper(coalesce(prod.barcode, '')) <> v_scan) then
    raise exception 'Wrong item. This line is %.', coalesce(prod.sku, 'an unmapped item');
  end if;

  v_picked := public.fulfillment_line_picked(line.id);
  if coalesce(p_quantity, -1) < 0 then raise exception 'Enter the count.'; end if;
  if p_quantity <> v_picked then
    insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, actor_user_id, metadata)
    values ('pack_check_mismatch', 'order_fulfillment_lines', line.id, ful.warehouse_id, auth.uid(),
      jsonb_build_object('fulfillment_id', ful.id, 'counted', p_quantity, 'picked', v_picked));
    raise exception 'Count % does not match the pick (%). Recount. If the pick is wrong, a supervisor must correct it.', p_quantity, v_picked;
  end if;

  update public.order_fulfillment_lines set packed_quantity = p_quantity, packed_at = timezone('utc', now()) where id = line.id;

  -- Packed when every line with picks is counted.
  select count(*) into v_open
  from public.order_fulfillment_lines ofl
  where ofl.fulfillment_id = ful.id and ofl.packed_quantity is null
    and public.fulfillment_line_picked(ofl.id) > 0;

  if v_open = 0 then
    update public.order_fulfillments set ww_stage = 'packed', packed_at = timezone('utc', now()), packed_by = auth.uid()
    where id = ful.id and ww_stage is null;
    insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, actor_user_id, metadata)
    values ('trip_packed', 'order_fulfillments', ful.id, ful.warehouse_id, auth.uid(), jsonb_build_object('document_number', ful.document_number));
  end if;

  return jsonb_build_object('packed', v_open = 0, 'open_lines', v_open);
end;
$$;

-- ============================================================
-- Stage: put a packed order in a staging lane
-- ============================================================
create or replace function public.stage_fulfillment(p_fulfillment_id uuid, p_location_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ful public.order_fulfillments%rowtype;
  lane public.locations%rowtype;
  v_list uuid;
begin
  ful := public.trip_fulfillment_for_floor(p_fulfillment_id);
  if ful.ww_stage is null then raise exception 'Pack check % first.', ful.document_number; end if;
  if ful.ww_stage = 'loaded' then raise exception 'Order % is already on the truck.', ful.document_number; end if;

  -- The office can add a line after the pack check (start_fulfillment_pick refresh).
  if exists (
    select 1 from public.pick_tasks pt join public.pick_lists pl on pl.id = pt.pick_list_id
    where pl.fulfillment_id = ful.id and pt.status not in ('completed', 'cancelled')
  ) or exists (
    select 1 from public.order_fulfillment_lines ofl
    where ofl.fulfillment_id = ful.id and public.fulfillment_line_picked(ofl.id) > 0
      and ofl.packed_quantity is distinct from public.fulfillment_line_picked(ofl.id)
  ) then
    raise exception 'Order % changed after the pack check. Finish the pick and pack check it again.', ful.document_number;
  end if;

  select l.* into lane from public.locations l join public.zones z on z.id = l.zone_id
  where l.warehouse_id = ful.warehouse_id and upper(l.code) = upper(trim(p_location_code)) and z.is_staging;
  if not found then raise exception 'Bin % is not a staging lane in this warehouse.', upper(trim(coalesce(p_location_code, ''))); end if;

  select id into v_list from public.pick_lists where fulfillment_id = ful.id;
  insert into public.staging_loads (pick_list_id, fulfillment_id, location_id, route_code, status)
  values (v_list, ful.id, lane.id, concat_ws(' ', ful.fulfillment_date::text, ful.truck_name, nullif('Trip ' || coalesce(ful.trip_number, ''), 'Trip ')), 'ready')
  on conflict (fulfillment_id) where fulfillment_id is not null
  do update set location_id = excluded.location_id, status = 'ready', blocker = null;

  update public.order_fulfillments set ww_stage = 'staged', staged_at = timezone('utc', now()), staging_location_id = lane.id where id = ful.id;
  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, to_location_id, actor_user_id, metadata)
  values ('trip_staged', 'order_fulfillments', ful.id, ful.warehouse_id, lane.id, auth.uid(), jsonb_build_object('document_number', ful.document_number, 'lane', lane.code));
  return jsonb_build_object('lane', lane.code);
end;
$$;

-- ============================================================
-- Load scan: at the truck, scan the order, IF or pick list number
-- ============================================================
-- p_fulfillment_ids = the fulfillments of the trip on screen. The scan must
-- match one of them, so an order of another trip cannot go on this truck.
create or replace function public.load_trip_scan(p_fulfillment_ids uuid[], p_scan text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scan text := upper(trim(coalesce(p_scan, '')));
  v_matches uuid[];
  v_pick uuid;
  ful public.order_fulfillments%rowtype;
begin
  if v_scan = '' then raise exception 'Scan the order label.'; end if;
  select array_agg(f.id) into v_matches
  from public.order_fulfillments f
  join public.orders o on o.id = f.order_id
  left join public.pick_lists pl on pl.fulfillment_id = f.id
  where f.id = any(p_fulfillment_ids)
    and v_scan in (upper(f.document_number), upper(o.order_number), upper(coalesce(pl.pick_list_number, '')));

  if v_matches is null then raise exception '% is not on this trip. Do not load it.', v_scan; end if;
  v_pick := v_matches[1];
  if array_length(v_matches, 1) > 1 then
    -- An order with two parts on one trip: load the next part that is not loaded.
    select f.id into v_pick from public.order_fulfillments f
    where f.id = any(v_matches) and f.ww_stage is distinct from 'loaded' order by f.document_number limit 1;
    v_pick := coalesce(v_pick, v_matches[1]);
  end if;

  ful := public.trip_fulfillment_for_floor(v_pick);
  if ful.ww_stage = 'loaded' then raise exception '% is already loaded.', ful.document_number; end if;
  if ful.ww_stage is distinct from 'staged' then raise exception 'Stage % first (pack check, then a staging lane).', ful.document_number; end if;

  update public.order_fulfillments set ww_stage = 'loaded', loaded_at = timezone('utc', now()), loaded_by = auth.uid() where id = ful.id;
  update public.staging_loads set status = 'loaded' where fulfillment_id = ful.id;
  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, actor_user_id, metadata)
  values ('trip_loaded', 'order_fulfillments', ful.id, ful.warehouse_id, auth.uid(), jsonb_build_object('document_number', ful.document_number, 'scan', v_scan));
  return jsonb_build_object('fulfillment_id', ful.id, 'document_number', ful.document_number);
end;
$$;

-- ============================================================
-- Depart: the trip leaves; queue Shipped for each loaded fulfillment
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
  ful record;
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
    insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, actor_user_id, metadata)
    values ('trip_departed', 'order_fulfillments', ful.id, ful.warehouse_id, auth.uid(),
      jsonb_build_object('document_number', ful.document_number, 'trip_number', ful.trip_number, 'truck', ful.truck_name, 'ship_short', v_short, 'sync_job_id', v_job));
    v_departed := v_departed + 1;
  end loop;

  if v_departed = 0 then raise exception 'Nothing to depart. This trip has already left.'; end if;

  return jsonb_build_object('departed', v_departed, 'queued', v_queued, 'posting_enabled', coalesce(v_post, false), 'ship_short', v_short);
end;
$$;

-- ============================================================
-- Trip board: add the floor stage (columns appended at the end)
-- ============================================================
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
  sj.error_message as ship_sync_error
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
-- A departed fulfillment stays until NetSuite shows Shipped, so a failed post is visible.
where f.external_status in ('A', 'B');

grant select on public.trip_board to authenticated;

-- ============================================================
-- Grants
-- ============================================================
revoke all on function public.fulfillment_line_picked(uuid) from public, anon;
revoke all on function public.trip_fulfillment_for_floor(uuid) from public, anon;
revoke all on function public.confirm_pack_line(uuid, text, numeric) from public, anon;
revoke all on function public.stage_fulfillment(uuid, text) from public, anon;
revoke all on function public.load_trip_scan(uuid[], text) from public, anon;
revoke all on function public.depart_trip(uuid[]) from public, anon;
grant execute on function public.fulfillment_line_picked(uuid) to authenticated, service_role;
grant execute on function public.confirm_pack_line(uuid, text, numeric) to authenticated, service_role;
grant execute on function public.stage_fulfillment(uuid, text) to authenticated, service_role;
grant execute on function public.load_trip_scan(uuid[], text) to authenticated, service_role;
grant execute on function public.depart_trip(uuid[]) to authenticated, service_role;
grant execute on function public.trip_fulfillment_for_floor(uuid) to service_role;
