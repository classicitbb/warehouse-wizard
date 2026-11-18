-- Trip board and floor picking (outbound picking design, slice E: D7, D8,
-- D10, O1, O3, N1, N2, N4, V22, and F5/F9 in §10).
--
-- The office plans each trip in NetSuite (O1). A trip is the IF date + truck +
-- trip number (O3). WW reads the office's item fulfillments (slice C) and
-- gives the floor one pick list per fulfillment: pick_lists.fulfillment_id,
-- one pick_tasks row per fulfillment line (pick_tasks.fulfillment_line_id).
--
-- A pick takes units off the pallets in the scanned bin (F5): the smallest
-- balance first, because the floor stacks a low remainder on top of the new
-- pallet. An empty pallet retires (status 'shipped', no bin, as in
-- confirm_pick_task: inventory_status has no picked value). A task directs
-- the picker to a bin, not to a pallet, so many fulfillments can pick from one
-- face at the same time (guard_one_open_pick_per_pallet only sees pallet_id).
--
-- The picked units stay on the open fulfillment until slice F loads and
-- departs it: WW location total = bins + picked on open fulfillments.
-- open_fulfillment_demand now takes off what WW picked for each fulfillment
-- line (F9), so the replenishment engine does not count it two times.
--
-- A short pick (D10) closes the task with what the picker found and makes an
-- urgent replenishment for the face. Ship short at trip close is slice F.
-- WW writes nothing to NetSuite in this slice.
--
-- Additive only.

-- ============================================================
-- Links from WW pick work to the office's fulfillments
-- ============================================================
alter table public.pick_lists
  add column if not exists fulfillment_id uuid references public.order_fulfillments (id) on delete set null;

create unique index if not exists pick_lists_fulfillment_idx
  on public.pick_lists (fulfillment_id) where fulfillment_id is not null;

alter table public.pick_tasks
  add column if not exists fulfillment_line_id uuid references public.order_fulfillment_lines (id) on delete set null;

create index if not exists pick_tasks_fulfillment_line_idx
  on public.pick_tasks (fulfillment_line_id) where fulfillment_line_id is not null;

comment on column public.pick_lists.fulfillment_id is 'The NetSuite item fulfillment (office plan, O1) that this pick list picks. One pick list per fulfillment.';
comment on column public.pick_tasks.fulfillment_line_id is 'The item fulfillment line this task picks. A trip task directs to a bin (location_id), not a pallet; picked_pallet_id is the last pallet it took units from.';

-- ============================================================
-- Open demand (F9): less what WW picked for the fulfillment line
-- ============================================================
create or replace function public.open_fulfillment_demand(p_warehouse_id uuid default null)
returns table (warehouse_id uuid, product_id uuid, quantity numeric)
language sql stable security definer set search_path = public as $$
  select f.warehouse_id, ofl.product_id, sum(greatest(ofl.quantity - coalesce(pk.picked, 0), 0))
  from public.order_fulfillment_lines ofl
  join public.order_fulfillments f on f.id = ofl.fulfillment_id
  join public.warehouses w on w.id = f.warehouse_id
  left join lateral (
    select sum(pt.confirmed_quantity) as picked
    from public.pick_tasks pt
    where pt.fulfillment_line_id = ofl.id
      and pt.status in ('in_progress', 'completed')
  ) pk on true
  where f.external_status in ('A', 'B')
    and ofl.product_id is not null
    and coalesce(f.fulfillment_date, f.created_at::date) >= current_date - w.replen_demand_max_age_days
    and (p_warehouse_id is null or f.warehouse_id = p_warehouse_id)
  group by f.warehouse_id, ofl.product_id
  having sum(greatest(ofl.quantity - coalesce(pk.picked, 0), 0)) > 0;
$$;

-- ============================================================
-- Where to pick a product: a pick face that holds it, by pick sequence,
-- else a bulk bin (FEFO or FIFO). Only bins that are not frozen.
-- ============================================================
create or replace function public.trip_pick_source(p_warehouse_id uuid, p_product_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select ib.location_id
  from public.inventory_balances ib
  join public.locations l on l.id = ib.location_id
  left join public.zones z on z.id = l.zone_id
  join public.products pr on pr.id = ib.product_id
  where ib.warehouse_id = p_warehouse_id
    and ib.product_id = p_product_id
    and ib.status = 'available'
    and ib.available_quantity > 0
    and l.status in ('pick_face', 'active')
    and not coalesce(z.is_staging or z.is_dispatch or z.is_quarantine, false)
    and not exists (
      select 1 from public.inventory_freezes fz
      where fz.status = 'active' and (fz.location_id = ib.location_id or fz.pallet_id = ib.pallet_id)
    )
  order by
    case when l.status = 'pick_face' then 0 else 1 end,
    case when l.status = 'pick_face' then l.pick_sequence end,
    case when l.status <> 'pick_face' and pr.rotation_method = 'fefo' then coalesce(ib.expiry_date, date '9999-12-31') end asc nulls last,
    case when l.status <> 'pick_face' then coalesce(ib.received_at, ib.created_at) end asc,
    l.code
  limit 1;
$$;

-- ============================================================
-- Start (or refresh) the pick list for one fulfillment
-- ============================================================
-- Idempotent. Adds a task for each fulfillment line that has none, changes the
-- requested quantity of open tasks when the office changed the line, gives a
-- bin to a no-stock line when stock came in, and cancels open tasks with
-- nothing picked whose line is gone. D8: refuses a sales order whose customer
-- is on credit hold.
create or replace function public.start_fulfillment_pick(p_fulfillment_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  ful public.order_fulfillments%rowtype;
  ord public.orders%rowtype;
  list_id uuid;
  line record;
  v_source uuid;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'Not authorized to pick'; end if;

  select * into ful from public.order_fulfillments where id = p_fulfillment_id;
  if not found then raise exception 'Fulfillment not found. Refresh the trip board.'; end if;
  if not public.can_access_warehouse(ful.warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;
  if ful.external_status not in ('A', 'B') then raise exception 'Fulfillment % is already shipped.', ful.document_number; end if;

  select * into ord from public.orders where id = ful.order_id;
  if ord.order_type = 'sales' and exists (
    select 1 from public.customers c where c.id = ord.customer_id and c.on_credit_hold
  ) then
    raise exception 'Customer is on credit hold. The office must release % before it is picked.', ord.order_number;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('trip-pick:' || ful.id::text, 0));

  select id into list_id from public.pick_lists where fulfillment_id = ful.id;
  if list_id is null then
    insert into public.pick_lists (pick_list_number, warehouse_id, order_id, fulfillment_id, consolidated, status, released_at, notes, created_by)
    values (
      'PKL-' || ful.document_number, ful.warehouse_id, ful.order_id, ful.id, false, 'in_progress',
      timezone('utc', now()),
      concat_ws(' · ', nullif(concat_ws(' ', 'Trip', ful.trip_number), 'Trip'), ful.truck_name),
      auth.uid()
    )
    returning id into list_id;
  else
    update public.pick_lists set
      status = case when status in ('completed', 'cancelled') then status else 'in_progress'::public.task_status end
    where id = list_id;
  end if;

  for line in
    select ofl.id, ofl.order_line_id, ofl.product_id, ofl.quantity
    from public.order_fulfillment_lines ofl
    where ofl.fulfillment_id = ful.id and ofl.quantity > 0
    order by ofl.external_line_id
  loop
    if exists (select 1 from public.pick_tasks where pick_list_id = list_id and fulfillment_line_id = line.id) then
      update public.pick_tasks set requested_quantity = line.quantity
      where pick_list_id = list_id and fulfillment_line_id = line.id
        and status not in ('completed', 'cancelled') and requested_quantity <> line.quantity;
      -- A line that had no stock gets a bin when stock came in (replenishment or count).
      if line.product_id is not null then
        update public.pick_tasks set
          location_id = public.trip_pick_source(ful.warehouse_id, line.product_id),
          status = 'queued',
          short_reason = null
        where pick_list_id = list_id and fulfillment_line_id = line.id
          and status = 'exception' and location_id is null and confirmed_quantity = 0
          and public.trip_pick_source(ful.warehouse_id, line.product_id) is not null;
      end if;
      continue;
    end if;

    v_source := case when line.product_id is null then null else public.trip_pick_source(ful.warehouse_id, line.product_id) end;
    insert into public.pick_tasks (task_number, pick_list_id, order_line_id, fulfillment_line_id, location_id, requested_quantity, status, short_reason, created_by)
    values (
      'PKT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      list_id, line.order_line_id, line.id, v_source, line.quantity,
      case when v_source is null then 'exception'::public.task_status else 'queued'::public.task_status end,
      case
        when line.product_id is null then 'Item is not mapped to a WW product.'
        when v_source is null then 'No stock in WW for this product. Replenish or count, then refresh.'
      end,
      auth.uid()
    );
  end loop;

  update public.pick_tasks pt set status = 'cancelled', short_reason = 'The office removed this line from the fulfillment.'
  where pt.pick_list_id = list_id
    and pt.status not in ('completed', 'cancelled')
    and pt.confirmed_quantity = 0
    and not exists (
      select 1 from public.order_fulfillment_lines ofl
      where ofl.id = pt.fulfillment_line_id and ofl.fulfillment_id = ful.id and ofl.quantity > 0
    );

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, actor_user_id, metadata)
  values ('trip_pick_started', 'pick_lists', list_id, ful.warehouse_id, auth.uid(),
    jsonb_build_object('fulfillment_id', ful.id, 'document_number', ful.document_number, 'trip_number', ful.trip_number, 'truck', ful.truck_name));

  return list_id;
end;
$$;

-- ============================================================
-- Confirm a floor pick from a bin
-- ============================================================
-- The picker scans the bin and enters the quantity (base units). The bin can
-- be the directed bin or another bin with the product. WW takes the units off
-- the pallets in the bin, the smallest balance first. A task can take more
-- than one pick (two faces). p_short = the picker found no more: the task
-- closes with what is picked, and a face gets an urgent replenishment (D10).
create or replace function public.confirm_trip_pick(p_task_id uuid, p_location_code text, p_quantity numeric, p_short boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  task public.pick_tasks%rowtype;
  list public.pick_lists%rowtype;
  bin public.locations%rowtype;
  v_product uuid;
  v_remaining numeric;
  v_take numeric;
  v_left numeric;
  v_picked numeric := 0;
  v_available numeric;
  v_last_pallet uuid;
  v_done boolean;
  v_replen uuid;
  bal record;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'Not authorized to pick'; end if;
  if coalesce(p_quantity, 0) < 0 then raise exception 'The quantity cannot be negative.'; end if;
  if coalesce(p_quantity, 0) = 0 and not p_short then raise exception 'Enter the quantity you picked.'; end if;

  select * into task from public.pick_tasks where id = p_task_id for update;
  if not found then raise exception 'Pick task not found. Refresh the pick list.'; end if;
  if task.status in ('completed', 'cancelled') then raise exception 'This line is already closed. Refresh the pick list.'; end if;
  if task.fulfillment_line_id is null then raise exception 'This task is not a trip pick. Use Pick Lists.'; end if;

  select * into list from public.pick_lists where id = task.pick_list_id;
  if not public.can_access_warehouse(list.warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;
  if exists (
    select 1 from public.order_fulfillments f
    where f.id = list.fulfillment_id and f.external_status not in ('A', 'B')
  ) then raise exception 'This fulfillment is already shipped. Refresh the trip board.'; end if;

  select ofl.product_id into v_product from public.order_fulfillment_lines ofl where ofl.id = task.fulfillment_line_id;
  if v_product is null then raise exception 'Item is not mapped to a WW product.'; end if;

  v_remaining := greatest(task.requested_quantity - task.confirmed_quantity, 0);
  if p_quantity > v_remaining then
    raise exception 'Only % more to pick on this line.', v_remaining;
  end if;

  if p_quantity > 0 then
    select * into bin from public.locations
    where warehouse_id = list.warehouse_id and upper(code) = upper(trim(p_location_code));
    if not found then raise exception 'Bin % is not in this warehouse.', upper(trim(p_location_code)); end if;
    if bin.status not in ('pick_face', 'active') then raise exception 'Bin % is not a pick bin (status %).', bin.code, bin.status; end if;
    perform public.assert_location_not_frozen(bin.id, null);

    select coalesce(sum(ib.available_quantity), 0) into v_available
    from public.inventory_balances ib
    where ib.location_id = bin.id and ib.product_id = v_product and ib.status = 'available';
    if v_available < p_quantity then
      raise exception 'Bin % has only % of this product. Pick what is there and mark short, or scan another bin.', bin.code, v_available;
    end if;

    v_take := p_quantity;
    for bal in
      select ib.id, ib.pallet_id, ib.available_quantity
      from public.inventory_balances ib
      where ib.location_id = bin.id and ib.product_id = v_product and ib.status = 'available' and ib.available_quantity > 0
      order by ib.available_quantity asc, coalesce(ib.received_at, ib.created_at) asc
      for update
    loop
      exit when v_take <= 0;
      v_left := greatest(bal.available_quantity - least(v_take, bal.available_quantity), 0);
      v_picked := least(v_take, bal.available_quantity);
      v_take := v_take - v_picked;
      v_last_pallet := bal.pallet_id;

      update public.inventory_balances set
        available_quantity = v_left,
        quantity = greatest(quantity - v_picked, 0),
        reserved_quantity = case when v_left = 0 then 0 else reserved_quantity end,
        status = case when v_left = 0 then 'shipped'::public.inventory_status else status end,
        location_id = case when v_left = 0 then null else location_id end,
        zone_id = case when v_left = 0 then null else zone_id end
      where id = bal.id;

      if bal.pallet_id is not null then
        update public.pallets set
          available_quantity = greatest(available_quantity - v_picked, 0),
          quantity = greatest(quantity - v_picked, 0),
          reserved_quantity = case when v_left = 0 then 0 else reserved_quantity end,
          status = case when v_left = 0 then 'shipped'::public.inventory_status else status end,
          current_location_id = case when v_left = 0 then null else current_location_id end,
          is_stored = case when v_left = 0 then false else is_stored end
        where id = bal.pallet_id;
      end if;
    end loop;

    insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, from_location_id, actor_user_id, metadata)
    values ('pick', 'pick_tasks', task.id, list.warehouse_id, v_last_pallet, bin.id, auth.uid(),
      jsonb_build_object('trip_pick', true, 'fulfillment_line_id', task.fulfillment_line_id, 'quantity', p_quantity,
        'directed_location_id', task.location_id, 'bin', bin.code, 'short', p_short));
  end if;

  v_done := p_short or task.confirmed_quantity + coalesce(p_quantity, 0) >= task.requested_quantity;

  update public.pick_tasks set
    confirmed_quantity = confirmed_quantity + coalesce(p_quantity, 0),
    picked_location_id = coalesce(bin.id, picked_location_id),
    picked_pallet_id = coalesce(v_last_pallet, picked_pallet_id),
    assigned_user_id = coalesce(assigned_user_id, auth.uid()),
    status = case when v_done then 'completed'::public.task_status else 'in_progress'::public.task_status end,
    short_reason = case
      when p_short and confirmed_quantity + coalesce(p_quantity, 0) < requested_quantity
        then format('Short by %s.', requested_quantity - confirmed_quantity - coalesce(p_quantity, 0))
      else short_reason
    end,
    completed_at = case when v_done then timezone('utc', now()) else completed_at end
  where id = task.id
  returning * into task;

  -- D10: a short on a face asks for an urgent pallet. The face is the bin the
  -- picker scanned, else the directed bin.
  if p_short and task.confirmed_quantity < task.requested_quantity then
    if exists (select 1 from public.locations where id = coalesce(bin.id, task.location_id) and status = 'pick_face') then
      v_replen := public.request_urgent_replenishment(coalesce(bin.id, task.location_id), v_product, 'short');
    end if;
    insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, from_location_id, actor_user_id, metadata)
    values ('pick_short', 'pick_tasks', task.id, list.warehouse_id, coalesce(bin.id, task.location_id), auth.uid(),
      jsonb_build_object('requested', task.requested_quantity, 'picked', task.confirmed_quantity, 'replenishment_task_id', v_replen));
  end if;

  select bool_and(status in ('completed', 'cancelled')) into v_done from public.pick_tasks where pick_list_id = list.id;
  if coalesce(v_done, false) then
    update public.pick_lists set status = 'completed' where id = list.id and status <> 'completed';
  end if;

  return jsonb_build_object(
    'task_status', task.status,
    'confirmed_quantity', task.confirmed_quantity,
    'requested_quantity', task.requested_quantity,
    'list_complete', coalesce(v_done, false),
    'replenishment_task_id', v_replen
  );
end;
$$;

-- ============================================================
-- Trip board: one row per open fulfillment (Picked or Packed) with its trip
-- key (O3), order, customer, part n of m (N2), pick progress and flags.
-- security_invoker keeps the fulfillment and pick RLS in force.
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
  -- V22: still open after the warehouse's demand age.
  coalesce(f.fulfillment_date, f.created_at::date) < current_date - w.replen_demand_max_age_days as is_aged
from public.order_fulfillments f
join public.warehouses w on w.id = f.warehouse_id
join public.orders o on o.id = f.order_id
left join public.customers c on c.id = o.customer_id
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
where f.external_status in ('A', 'B');

grant select on public.trip_board to authenticated;

-- The Pick Lists page leaves out trip pick lists (they use the trip handset),
-- so its nav badge and dashboard tile must too. Change only that one count in
-- the live dashboard_metrics_summary (last defined in 20261001140000).
do $$
declare
  v_def text := pg_get_functiondef('public.dashboard_metrics_summary(uuid)'::regprocedure);
  v_old text := E'''openPickLists'', (select count(*) from public.pick_lists t\n        where t.status::text in (''draft'',''queued'',''assigned'',''in_progress'',''exception'')';
  v_new text := E'''openPickLists'', (select count(*) from public.pick_lists t\n        where t.fulfillment_id is null and t.status::text in (''draft'',''queued'',''assigned'',''in_progress'',''exception'')';
begin
  if position(v_new in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'dashboard_metrics_summary changed: update its openPickLists count by hand.';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end $$;

revoke all on function public.trip_pick_source(uuid, uuid) from public, anon;
revoke all on function public.start_fulfillment_pick(uuid) from public, anon;
revoke all on function public.confirm_trip_pick(uuid, text, numeric, boolean) from public, anon;
grant execute on function public.start_fulfillment_pick(uuid) to authenticated, service_role;
grant execute on function public.confirm_trip_pick(uuid, text, numeric, boolean) to authenticated, service_role;
grant execute on function public.trip_pick_source(uuid, uuid) to service_role;
