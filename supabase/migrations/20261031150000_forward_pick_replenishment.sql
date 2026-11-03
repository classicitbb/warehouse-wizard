-- Forward pick and replenishment (outbound picking design, slice D: D4, D5,
-- T4, C2, C6, and the floor practice in §10).
--
-- A pick face is a bin with locations.status = 'pick_face'. The bin keeps its
-- code and its barcode label. A face has no fixed SKU: the SKU comes with the
-- first pallet that a replenishment moves in, and the face is free again when
-- that stock is gone. A face holds up to max_pallets pallets, of one SKU or of
-- several.
--
-- Put-away and directed put-away use only 'active' bins, so they never fill a
-- face. Bulk sourcing (replenishment_source_pallet, whole-pallet picks) also
-- uses only 'active' bins, so it never sees face stock. A pallet on a face goes
-- back to bulk only by a move out of the face.
--
-- The engine (cron each 5 minutes) asks for full pallets from bulk when the
-- face stock of a SKU, less the open demand, goes down to the trigger level:
-- a percentage of the quantity in the face after its last fill. WW learns
-- the percentage and the number of pallets from the average daily use of the
-- last 30 days: a product that ships a full pallet or more a day gets 75 % and
-- 2 or more pallets; other products get 50 % and 1 pallet. Until a warehouse
-- has 30 days of shipped history, every product gets the minimum (50 %, 1
-- pallet). Open demand is the lines of the
-- office's open fulfillments (Picked or Packed, O1), less what WW has picked,
-- and without aged fulfillments. The move stays in WW (D4).
--
-- Not in this slice: the push notification to the floor (D5), the TO
-- full-pallet split (T3/T4), and the floor pick (slice E calls
-- request_urgent_replenishment on a short pick, D10).
--
-- Additive only.

-- ============================================================
-- Settings
-- ============================================================
alter table public.products
  add column if not exists replen_trigger_pct numeric(5,2) check (replen_trigger_pct is null or (replen_trigger_pct > 0 and replen_trigger_pct < 100)),
  add column if not exists replen_pallets     integer      check (replen_pallets is null or replen_pallets between 1 and 10);

comment on column public.products.replen_trigger_pct is 'Pick face trigger level, % of the quantity after the last fill. Null = learned from the 30-day average use (75 or 50).';
comment on column public.products.replen_pallets is 'Full pallets to bring into a pick face per trigger. Null = learned from the 30-day average use (1 to 5).';

alter table public.warehouses
  add column if not exists replen_demand_max_age_days integer not null default 3 check (replen_demand_max_age_days >= 0);

comment on column public.warehouses.replen_demand_max_age_days is 'An open fulfillment older than this many days is aged: it stops counting as pick face demand.';

comment on column public.locations.status is 'active, blocked, maintenance, disabled, or pick_face (a forward-pick bin that only replenishment fills).';

-- ============================================================
-- pick_face_slots: the SKU in a face now, and its fill quantity
-- ============================================================
create table if not exists public.pick_face_slots (
  location_id   uuid not null references public.locations (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  warehouse_id  uuid not null references public.warehouses (id) on delete cascade,
  -- Base units in the face for this SKU after the last fill (D9).
  full_quantity numeric(18,4) not null default 0 check (full_quantity >= 0),
  filled_at     timestamptz not null default now(),
  primary key (location_id, product_id)
);

create index if not exists pick_face_slots_product_idx on public.pick_face_slots (warehouse_id, product_id);

alter table public.pick_face_slots enable row level security;

drop policy if exists "Scoped read pick_face_slots" on public.pick_face_slots;
create policy "Scoped read pick_face_slots" on public.pick_face_slots
  for select to authenticated using (public.is_approved() and public.can_access_warehouse(warehouse_id));

-- Only the definer functions below write slots.
grant select on public.pick_face_slots to authenticated;

-- ============================================================
-- replenishment_tasks: forward-pick fields. One task = one pallet.
-- ============================================================
alter table public.replenishment_tasks
  add column if not exists priority           text not null default 'normal',
  add column if not exists reason             text not null default 'min',
  add column if not exists on_hand_quantity   numeric(18,4) not null default 0,
  add column if not exists demand_quantity    numeric(18,4) not null default 0,
  add column if not exists suggested_pallet_id uuid references public.pallets (id) on delete set null,
  add column if not exists move_task_id       uuid references public.move_tasks (id) on delete set null,
  add column if not exists notes              text,
  add column if not exists created_by         uuid references auth.users (id) on delete set null,
  add column if not exists updated_at         timestamptz not null default now();

alter table public.replenishment_tasks drop constraint if exists replenishment_tasks_priority_check;
alter table public.replenishment_tasks add constraint replenishment_tasks_priority_check
  check (priority in ('normal', 'urgent'));
alter table public.replenishment_tasks drop constraint if exists replenishment_tasks_reason_check;
alter table public.replenishment_tasks add constraint replenishment_tasks_reason_check
  check (reason in ('min', 'demand', 'short', 'count_variance', 'manual'));

-- A bulk pallet belongs to one open task at a time.
create unique index if not exists replenishment_tasks_open_pallet_idx
  on public.replenishment_tasks (suggested_pallet_id)
  where suggested_pallet_id is not null and status in ('queued', 'assigned', 'in_progress');
create index if not exists replenishment_tasks_open_product_idx
  on public.replenishment_tasks (warehouse_id, product_id)
  where status in ('queued', 'assigned', 'in_progress', 'exception');
create index if not exists replenishment_tasks_move_task_idx on public.replenishment_tasks (move_task_id);

drop trigger if exists set_replenishment_tasks_updated_at on public.replenishment_tasks;
create trigger set_replenishment_tasks_updated_at
  before update on public.replenishment_tasks
  for each row execute function public.set_updated_at();

comment on column public.replenishment_tasks.priority is 'urgent = the faces cannot cover the open demand, or a picker reported short (D5, D10).';
comment on column public.replenishment_tasks.reason is 'min = at the fill trigger level; demand = open fulfillments take it to the trigger; short = picker short; count_variance = C6; manual.';

-- ============================================================
-- Helpers
-- ============================================================

-- Average daily use of a product in a warehouse: the shipped fulfillment
-- lines of the last 30 days, divided by 30. Null while the warehouse has less
-- than 30 days of shipped history: WW is still learning.
create or replace function public.product_daily_use(p_warehouse_id uuid, p_product_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case
    when coalesce(
      (select min(f.fulfillment_date) from public.order_fulfillments f
       where f.warehouse_id = p_warehouse_id and f.external_status = 'C'),
      current_date
    ) > current_date - 30 then null
    else coalesce((
      select sum(ofl.quantity)
      from public.order_fulfillment_lines ofl
      join public.order_fulfillments f on f.id = ofl.fulfillment_id
      where f.warehouse_id = p_warehouse_id and f.external_status = 'C'
        and ofl.product_id = p_product_id and f.fulfillment_date > current_date - 30
    ), 0) / 30
  end;
$$;

-- Trigger percentage and full pallets per trigger for a product in a
-- warehouse. A value set on the product wins. Otherwise WW learns it: a
-- product that uses a full pallet or more a day (the largest pallet of it in
-- the warehouse) gets 75 % and 2 to 5 pallets; other products, and every
-- product while WW is learning, get the minimum: 50 % and 1 pallet.
-- basis: set, learned or learning.
create or replace function public.replenishment_policy(p_product_id uuid, p_warehouse_id uuid)
returns table (trigger_pct numeric, pallets integer, daily_use numeric, basis text)
language sql stable security definer set search_path = public as $$
  with u as (
    select public.product_daily_use(p_warehouse_id, p_product_id) as daily_use,
           (select max(ib.quantity) from public.inventory_balances ib
            where ib.warehouse_id = p_warehouse_id and ib.product_id = p_product_id and ib.status = 'available') as pallet_qty
  ),
  l as (
    select u.daily_use,
           case when u.daily_use is null or coalesce(u.pallet_qty, 0) <= 0 then null else u.daily_use / u.pallet_qty end as pallets_per_day
    from u
  )
  select
    coalesce(p.replen_trigger_pct, case when l.pallets_per_day >= 1 then 75 else 50 end)::numeric,
    coalesce(p.replen_pallets, case when l.pallets_per_day >= 1 then least(greatest(ceil(l.pallets_per_day)::int, 2), 5) else 1 end),
    l.daily_use,
    case
      when p.replen_trigger_pct is not null or p.replen_pallets is not null then 'set'
      when l.daily_use is null then 'learning'
      else 'learned'
    end
  from public.products p
  cross join l
  where p.id = p_product_id;
$$;

-- Base-unit stock of a product that a picker can take from a face now.
create or replace function public.pick_face_on_hand(p_location_id uuid, p_product_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(ib.available_quantity), 0)
  from public.inventory_balances ib
  where ib.location_id = p_location_id
    and ib.product_id = p_product_id
    and ib.status = 'available';
$$;

-- Open demand (a soft reservation): the lines of the office's open
-- fulfillments (Picked or Packed, O1), less what WW has picked for the line,
-- per warehouse and product. A fulfillment older than the warehouse's
-- replen_demand_max_age_days is aged and does not count. Shipped lines are
-- gone from the shelf already.
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
    where ofl.order_line_id is not null
      and pt.order_line_id = ofl.order_line_id
      and pt.status = 'completed'
  ) pk on true
  where f.external_status in ('A', 'B')
    and ofl.product_id is not null
    and coalesce(f.fulfillment_date, f.created_at::date) >= current_date - w.replen_demand_max_age_days
    and (p_warehouse_id is null or f.warehouse_id = p_warehouse_id)
  group by f.warehouse_id, ofl.product_id
  having sum(greatest(ofl.quantity - coalesce(pk.picked, 0), 0)) > 0;
$$;

create or replace function public.pick_face_demand(p_warehouse_id uuid, p_product_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select d.quantity from public.open_fulfillment_demand(p_warehouse_id) d where d.product_id = p_product_id), 0);
$$;

-- The best bulk pallet to bring into a face: available stock of the product
-- in an 'active' bin (so never a face), outside staging, dispatch and
-- quarantine zones, not frozen (C2), not given to another open task, and with
-- no open move or pick work. FEFO or FIFO from the product.
create or replace function public.replenishment_source_pallet(p_warehouse_id uuid, p_product_id uuid, p_exclude uuid[] default '{}')
returns table (pallet_id uuid, location_id uuid, available_quantity numeric)
language sql stable security definer set search_path = public as $$
  select ib.pallet_id, ib.location_id, ib.available_quantity
  from public.inventory_balances ib
  join public.locations l on l.id = ib.location_id
  left join public.zones z on z.id = l.zone_id
  join public.products pr on pr.id = ib.product_id
  where ib.warehouse_id = p_warehouse_id
    and ib.product_id = p_product_id
    and ib.status = 'available'
    and ib.available_quantity > 0
    and l.status = 'active'
    and not coalesce(z.is_staging or z.is_dispatch or z.is_quarantine, false)
    and not (ib.pallet_id = any (coalesce(p_exclude, '{}')))
    and not exists (
      select 1 from public.inventory_freezes fz
      where fz.status = 'active' and (fz.location_id = ib.location_id or fz.pallet_id = ib.pallet_id)
    )
    and not exists (
      select 1 from public.replenishment_tasks rt
      where rt.suggested_pallet_id = ib.pallet_id and rt.status in ('queued', 'assigned', 'in_progress')
    )
    and not exists (
      select 1 from public.move_tasks mt
      where mt.pallet_id = ib.pallet_id and mt.status in ('queued', 'assigned', 'in_progress')
    )
    and not exists (
      select 1 from public.pick_tasks pt
      where pt.pallet_id = ib.pallet_id and pt.status in ('queued', 'assigned', 'in_progress')
    )
  order by
    case when pr.rotation_method = 'fefo' then coalesce(ib.expiry_date, date '9999-12-31') end asc nulls last,
    coalesce(ib.received_at, ib.created_at) asc
  limit 1;
$$;

-- The face to bring the next pallet of a product to. A face has room when its
-- pallets plus the pallets already on their way are fewer than max_pallets. A
-- low remainder pallet of the same product (25 % or less of the fill) does not
-- take a place: the floor stacks it on the new pallet. Order: a face that
-- holds the product, then an empty face, then a face with other products.
create or replace function public.pick_face_target(p_warehouse_id uuid, p_product_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select l.id
  from public.locations l
  join public.products pr on pr.id = p_product_id
  left join lateral (
    select
      count(distinct ib.pallet_id) filter (
        where not (ib.product_id = p_product_id and ib.available_quantity <= 0.25 * coalesce(s.full_quantity, 0))
      ) as pallets,
      count(distinct ib.product_id) as products,
      bool_or(ib.product_id = p_product_id) as has_product
    from public.inventory_balances ib
    left join public.pick_face_slots s on s.location_id = ib.location_id and s.product_id = ib.product_id
    where ib.location_id = l.id
      and ib.quantity > 0
      and ib.status::text not in ('picked', 'shipped', 'in_transit', 'missing')
  ) st on true
  left join lateral (
    select count(*) as tasks, bool_or(t.product_id = p_product_id) as has_product
    from public.replenishment_tasks t
    where t.to_location_id = l.id and t.status in ('queued', 'assigned', 'in_progress')
  ) ot on true
  where l.warehouse_id = p_warehouse_id
    and l.status = 'pick_face'
    and (pr.temperature_requirement is null or l.temperature_class::text = pr.temperature_requirement::text)
    and not exists (select 1 from public.inventory_freezes fz where fz.status = 'active' and fz.location_id = l.id)
    and greatest(coalesce(l.max_pallets, 1), 1) - coalesce(st.pallets, 0) - coalesce(ot.tasks, 0) > 0
  order by
    case
      when coalesce(st.has_product, false) or coalesce(ot.has_product, false)
        or exists (select 1 from public.pick_face_slots s2 where s2.location_id = l.id and s2.product_id = p_product_id) then 0
      when coalesce(st.products, 0) = 0 and coalesce(ot.tasks, 0) = 0
        and not exists (select 1 from public.pick_face_slots s3 where s3.location_id = l.id) then 1
      else 2
    end,
    l.pick_sequence,
    l.code
  limit 1;
$$;

-- ============================================================
-- Engine (D5)
-- ============================================================

-- One pass per warehouse that has pick faces (one warehouse, or all when
-- null). For each product on a face, or with open demand, or with an open
-- task:
--   projected = face stock - open demand
--   trigger   = fill quantity x trigger %
-- On a face: when projected <= trigger, bring the policy's full pallets, and
-- more while the pallets cannot cover a shortage. Urgent when projected < 0
-- (short before fulfillment: picking still goes on).
-- Not on a face: a product with open demand gets a face when its policy asks
-- for 2 or more pallets (a fast mover), or when the demand is not a whole
-- number of its full bulk pallets
-- (whole pallets go from bulk), and a face has room. Otherwise it stays in
-- bulk, with no task.
-- A queued engine task that is no longer needed is cancelled. A face slot
-- with no stock and no open task is released, so the face is free for any SKU.
create or replace function public.evaluate_forward_pick_replenishment(p_warehouse_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  item record;
  src record;
  v_exception record;
  v_exclude uuid[];
  v_target uuid;
  v_projected numeric;
  v_full numeric;
  v_level numeric;
  v_needed boolean;
  v_priority text;
  v_reason text;
  v_open int;
  v_covered numeric;
  v_cover numeric;
  v_guard int;
  v_note text;
  v_count int;
  v_created int := 0;
  v_updated int := 0;
  v_cancelled int := 0;
  v_released int := 0;
begin
  -- The cron job runs without a user; a person must be approved and see the warehouse.
  if auth.uid() is not null then
    if not public.is_approved() then raise exception 'Not authorized'; end if;
    if p_warehouse_id is not null and not public.can_access_warehouse(p_warehouse_id) then
      raise exception 'Not authorized for this warehouse';
    end if;
  end if;

  -- Stock already on a face with no slot (a bin converted with stock in it):
  -- its fill is what is there now. Stock above the fill raises the fill.
  insert into public.pick_face_slots (location_id, product_id, warehouse_id, full_quantity)
  select ib.location_id, ib.product_id, l.warehouse_id, sum(ib.available_quantity)
  from public.inventory_balances ib
  join public.locations l on l.id = ib.location_id
  where l.status = 'pick_face' and ib.status = 'available' and ib.available_quantity > 0 and ib.product_id is not null
    and (p_warehouse_id is null or l.warehouse_id = p_warehouse_id)
  group by ib.location_id, ib.product_id, l.warehouse_id
  on conflict (location_id, product_id) do update
    set full_quantity = greatest(public.pick_face_slots.full_quantity, excluded.full_quantity);

  for item in
    with wh as (
      select distinct l.warehouse_id
      from public.locations l
      where l.status = 'pick_face'
        and (p_warehouse_id is null or l.warehouse_id = p_warehouse_id)
        and (auth.uid() is null or public.can_access_warehouse(l.warehouse_id))
    ),
    face_stock as (
      select s.warehouse_id, s.product_id, sum(s.full_quantity) as full_quantity,
             sum(public.pick_face_on_hand(s.location_id, s.product_id)) as on_hand
      from public.pick_face_slots s
      join public.locations l on l.id = s.location_id and l.status = 'pick_face'
      where s.warehouse_id in (select warehouse_id from wh)
      group by s.warehouse_id, s.product_id
    ),
    demand as (
      select d.* from public.open_fulfillment_demand(p_warehouse_id) d
      where d.warehouse_id in (select warehouse_id from wh)
    ),
    open_tasks as (
      select distinct t.warehouse_id, t.product_id
      from public.replenishment_tasks t
      where t.status in ('queued', 'assigned', 'in_progress', 'exception')
        and t.warehouse_id in (select warehouse_id from wh) and t.product_id is not null
    ),
    keys as (
      select warehouse_id, product_id from face_stock
      union select warehouse_id, product_id from demand
      union select warehouse_id, product_id from open_tasks
    )
    select k.warehouse_id, k.product_id,
           (fs.product_id is not null) as on_face,
           coalesce(fs.on_hand, 0) as on_hand,
           coalesce(fs.full_quantity, 0) as full_quantity,
           coalesce(d.quantity, 0) as demand,
           pol.trigger_pct, pol.pallets,
           (select max(ib.available_quantity)
              from public.inventory_balances ib
              join public.locations bl on bl.id = ib.location_id and bl.status = 'active'
              where ib.warehouse_id = k.warehouse_id and ib.product_id = k.product_id and ib.status = 'available') as full_pallet
    from keys k
    join public.products p on p.id = k.product_id
    left join face_stock fs on fs.warehouse_id = k.warehouse_id and fs.product_id = k.product_id
    left join demand d on d.warehouse_id = k.warehouse_id and d.product_id = k.product_id
    left join lateral public.replenishment_policy(k.product_id, k.warehouse_id) pol on true
    -- Products already on a face get the free places first.
    order by (fs.product_id is not null) desc, coalesce(d.quantity, 0) desc
  loop
    v_projected := item.on_hand - item.demand;
    v_full := greatest(item.full_quantity, item.on_hand);
    v_level := round(v_full * item.trigger_pct / 100, 4);

    if item.on_face then
      v_needed := (item.on_hand > 0 or item.demand > 0) and v_projected <= v_level;
    else
      v_needed := item.demand > 0 and (
        item.pallets >= 2
        or item.full_pallet is null
        or mod(item.demand, item.full_pallet) <> 0
      );
    end if;

    if not v_needed then
      update public.replenishment_tasks
      set status = 'cancelled', notes = 'No longer needed.', completed_at = now()
      where warehouse_id = item.warehouse_id and product_id = item.product_id
        and status in ('queued', 'exception') and move_task_id is null and reason in ('min', 'demand');
      get diagnostics v_count = row_count;
      v_cancelled := v_cancelled + v_count;
      continue;
    end if;

    v_priority := case when v_projected < 0 then 'urgent' else 'normal' end;
    v_reason := case when item.on_hand <= v_level then 'min' else 'demand' end;
    v_cover := greatest(-v_projected, 0);

    -- Refresh the numbers on the open tasks. A short or count task stays urgent.
    update public.replenishment_tasks set
      on_hand_quantity = item.on_hand,
      demand_quantity = item.demand,
      reorder_point = v_level,
      priority = case when reason in ('short', 'count_variance') then 'urgent' else v_priority end
    where warehouse_id = item.warehouse_id and product_id = item.product_id
      and status in ('queued', 'assigned', 'in_progress', 'exception')
      and (on_hand_quantity, demand_quantity, reorder_point, priority)
          is distinct from (item.on_hand, item.demand, v_level, case when reason in ('short', 'count_variance') then 'urgent' else v_priority end);
    get diagnostics v_count = row_count;
    v_updated := v_updated + v_count;

    select count(*), coalesce(sum(t.target_quantity), 0) into v_open, v_covered
    from public.replenishment_tasks t
    where t.warehouse_id = item.warehouse_id and t.product_id = item.product_id
      and t.status in ('queued', 'assigned', 'in_progress');

    v_exclude := '{}';
    v_guard := 0;
    while (v_open < item.pallets or v_covered < v_cover) and v_guard < 10 loop
      v_guard := v_guard + 1;
      select * into src from public.replenishment_source_pallet(item.warehouse_id, item.product_id, v_exclude);
      v_target := case when src.pallet_id is null then null else public.pick_face_target(item.warehouse_id, item.product_id) end;
      v_note := case
        when src.pallet_id is null then 'No bulk stock to replenish from.'
        when v_target is null then 'No pick face has room. Make a pick face or free a place.'
      end;

      select * into v_exception from public.replenishment_tasks t
      where t.warehouse_id = item.warehouse_id and t.product_id = item.product_id
        and t.status = 'exception' and t.move_task_id is null
      order by t.created_at limit 1;

      if v_note is not null then
        -- A product not on a face stays in bulk: the picker takes it there.
        if not item.on_face then exit; end if;
        if v_exception.id is null then
          insert into public.replenishment_tasks (
            task_number, warehouse_id, product_id, reorder_point, target_quantity, on_hand_quantity, demand_quantity,
            priority, reason, status, notes
          ) values (
            'RPL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
            item.warehouse_id, item.product_id, v_level, 0, item.on_hand, item.demand,
            v_priority, v_reason, 'exception', v_note
          );
          v_created := v_created + 1;
        elsif v_exception.notes is distinct from v_note then
          update public.replenishment_tasks set notes = v_note where id = v_exception.id;
        end if;
        exit;
      end if;

      if v_exception.id is not null then
        -- Stock or a place came back: the exception task becomes the pallet's task.
        update public.replenishment_tasks set
          status = 'queued', notes = null, to_location_id = v_target, from_location_id = src.location_id,
          suggested_pallet_id = src.pallet_id, target_quantity = src.available_quantity
        where id = v_exception.id;
        v_updated := v_updated + 1;
      else
        insert into public.replenishment_tasks (
          task_number, warehouse_id, product_id, to_location_id, from_location_id, suggested_pallet_id,
          reorder_point, target_quantity, on_hand_quantity, demand_quantity, priority, reason, status
        ) values (
          'RPL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
          item.warehouse_id, item.product_id, v_target, src.location_id, src.pallet_id,
          v_level, src.available_quantity, item.on_hand, item.demand, v_priority, v_reason, 'queued'
        );
        v_created := v_created + 1;
      end if;

      v_exclude := v_exclude || src.pallet_id;
      v_open := v_open + 1;
      v_covered := v_covered + src.available_quantity;
    end loop;
  end loop;

  -- Free the face slots that have no stock and no open task.
  delete from public.pick_face_slots s
  where (p_warehouse_id is null or s.warehouse_id = p_warehouse_id)
    and public.pick_face_on_hand(s.location_id, s.product_id) = 0
    and not exists (
      select 1 from public.replenishment_tasks t
      where t.to_location_id = s.location_id and t.product_id = s.product_id
        and t.status in ('queued', 'assigned', 'in_progress')
    );
  get diagnostics v_released = row_count;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'cancelled', v_cancelled, 'released', v_released);
end;
$$;

-- Short pick (D10) or a negative count variance on a face (C6): make the
-- product's open tasks urgent, or make a new urgent task for this face.
create or replace function public.request_urgent_replenishment(p_location_id uuid, p_product_id uuid, p_reason text default 'short')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  face public.locations%rowtype;
  open_task_id uuid;
  src record;
  v_on_hand numeric;
  v_demand numeric;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'Not authorized'; end if;
  if p_reason not in ('short', 'count_variance', 'manual') then raise exception 'Unknown replenishment reason: %', p_reason; end if;

  select * into face from public.locations where id = p_location_id;
  if not found or face.status <> 'pick_face' then raise exception 'This bin is not a pick face.'; end if;
  if not public.can_access_warehouse(face.warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;

  v_on_hand := public.pick_face_on_hand(face.id, p_product_id);
  v_demand := public.pick_face_demand(face.warehouse_id, p_product_id);

  update public.replenishment_tasks set priority = 'urgent', reason = p_reason,
    on_hand_quantity = v_on_hand, demand_quantity = v_demand
  where warehouse_id = face.warehouse_id and product_id = p_product_id
    and status in ('queued', 'assigned', 'in_progress');
  select id into open_task_id from public.replenishment_tasks
  where warehouse_id = face.warehouse_id and product_id = p_product_id
    and status in ('queued', 'assigned', 'in_progress')
  order by created_at limit 1;
  if open_task_id is not null then return open_task_id; end if;

  select * into src from public.replenishment_source_pallet(face.warehouse_id, p_product_id);
  insert into public.replenishment_tasks (
    task_number, warehouse_id, product_id, to_location_id, from_location_id, suggested_pallet_id,
    target_quantity, on_hand_quantity, demand_quantity, priority, reason, status, notes, created_by
  ) values (
    'RPL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    face.warehouse_id, p_product_id, face.id, src.location_id, src.pallet_id,
    coalesce(src.available_quantity, 0), v_on_hand, v_demand, 'urgent', p_reason,
    case when src.pallet_id is null then 'exception'::public.task_status else 'queued'::public.task_status end,
    case when src.pallet_id is null then 'No bulk stock to replenish from.' end,
    auth.uid()
  ) returning id into open_task_id;
  return open_task_id;
end;
$$;

-- ============================================================
-- Pick face bins: make and release
-- ============================================================

-- Makes a bin a pick face in place: same code, same barcode. Mixed SKUs are
-- allowed, up to max_pallets pallets.
create or replace function public.make_pick_face(p_location_id uuid, p_max_pallets integer default null)
returns void language plpgsql security definer set search_path = public as $$
declare loc public.locations%rowtype;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'warehouse_manager') then raise exception 'Not authorized'; end if;
  select * into loc from public.locations where id = p_location_id for update;
  if not found then raise exception 'Bin not found'; end if;
  if not public.can_access_warehouse(loc.warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;
  if loc.status = 'pick_face' then return; end if;
  if p_max_pallets is not null and (p_max_pallets < 1 or p_max_pallets > 10) then raise exception 'Pallets per face must be 1 to 10.'; end if;
  perform public.assert_location_not_frozen(loc.id, null);

  update public.locations set
    status = 'pick_face',
    mixed_sku_allowed = true,
    max_pallets = coalesce(p_max_pallets, greatest(coalesce(max_pallets, 1), 1))
  where id = loc.id;

  perform public.log_audit_event('pick_face_made', 'locations', loc.id, loc.warehouse_id, null, loc.id, null,
    jsonb_build_object('code', loc.code, 'previous_status', loc.status, 'max_pallets', coalesce(p_max_pallets, loc.max_pallets)));
end;
$$;

-- Makes a pick face a normal bin again (active or disabled). Stock in it
-- becomes bulk stock. Not while a replenishment is on its way to it.
create or replace function public.release_pick_face(p_location_id uuid, p_status text default 'active')
returns void language plpgsql security definer set search_path = public as $$
declare loc public.locations%rowtype;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'warehouse_manager') then raise exception 'Not authorized'; end if;
  if p_status not in ('active', 'disabled') then raise exception 'A released pick face becomes active or disabled.'; end if;
  select * into loc from public.locations where id = p_location_id for update;
  if not found then raise exception 'Bin not found'; end if;
  if not public.can_access_warehouse(loc.warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;
  if loc.status <> 'pick_face' then return; end if;
  if exists (select 1 from public.replenishment_tasks t where t.to_location_id = loc.id and t.status in ('queued', 'assigned', 'in_progress', 'exception')) then
    raise exception 'A replenishment is open for %. Finish or cancel it first.', loc.code;
  end if;

  update public.locations set status = p_status where id = loc.id;
  delete from public.pick_face_slots where location_id = loc.id;

  perform public.log_audit_event('pick_face_released', 'locations', loc.id, loc.warehouse_id, null, loc.id, null,
    jsonb_build_object('code', loc.code, 'new_status', p_status));
end;
$$;

-- ============================================================
-- Execution: a replenishment is a WW move (D4)
-- ============================================================

-- Picks the source pallet and the face again (the suggestion can be stale),
-- makes the move task and gives the task to the caller. The floor finishes it
-- by scan.
create or replace function public.start_replenishment_task(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  task public.replenishment_tasks%rowtype;
  src record;
  v_target uuid;
  v_move_id uuid;
  v_move_number text;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'Not authorized'; end if;
  select * into task from public.replenishment_tasks where id = p_task_id for update;
  if not found then raise exception 'Replenishment task not found'; end if;
  if not public.can_access_warehouse(task.warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;

  if task.status in ('assigned', 'in_progress') and task.move_task_id is not null then
    select task_number into v_move_number from public.move_tasks where id = task.move_task_id;
    return jsonb_build_object('move_task_id', task.move_task_id, 'move_task_number', v_move_number);
  end if;
  if task.status not in ('queued', 'exception') then raise exception 'This replenishment task is closed.'; end if;

  -- Keep the suggestion while it is still a valid source. The task's own
  -- suggestion does not exclude itself.
  if task.suggested_pallet_id is not null and exists (
    select 1 from public.inventory_balances ib
    join public.locations l on l.id = ib.location_id
    where ib.pallet_id = task.suggested_pallet_id and ib.status = 'available' and ib.available_quantity > 0 and l.status = 'active'
      and not exists (select 1 from public.move_tasks mt where mt.pallet_id = ib.pallet_id and mt.status in ('queued', 'assigned', 'in_progress'))
  ) then
    select ib.pallet_id, ib.location_id, ib.available_quantity into src
    from public.inventory_balances ib where ib.pallet_id = task.suggested_pallet_id and ib.status = 'available' limit 1;
  else
    select * into src from public.replenishment_source_pallet(task.warehouse_id, task.product_id);
  end if;
  if src.pallet_id is null then
    update public.replenishment_tasks set status = 'exception', notes = 'No bulk stock to replenish from.' where id = task.id;
    return jsonb_build_object('error', 'No bulk stock to replenish from.');
  end if;

  v_target := task.to_location_id;
  if v_target is null or not exists (select 1 from public.locations where id = v_target and status = 'pick_face') then
    v_target := public.pick_face_target(task.warehouse_id, task.product_id);
  end if;
  if v_target is null then
    update public.replenishment_tasks set status = 'exception', notes = 'No pick face has room. Make a pick face or free a place.' where id = task.id;
    return jsonb_build_object('error', 'No pick face has room. Make a pick face or free a place.');
  end if;
  perform public.assert_location_not_frozen(v_target, null);

  v_move_number := 'MOV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.move_tasks (task_number, pallet_id, warehouse_id, from_location_id, to_location_id, status, reason, assigned_user_id, created_by)
  values (v_move_number, src.pallet_id, task.warehouse_id, src.location_id, v_target, 'in_progress',
          'Replenishment ' || task.task_number, auth.uid(), auth.uid())
  returning id into v_move_id;

  update public.replenishment_tasks set
    status = 'in_progress', assigned_user_id = auth.uid(), move_task_id = v_move_id, to_location_id = v_target,
    suggested_pallet_id = src.pallet_id, from_location_id = src.location_id, target_quantity = src.available_quantity, notes = null
  where id = task.id;

  perform public.log_audit_event('replenishment_task_started', 'replenishment_tasks', task.id, task.warehouse_id, src.pallet_id, src.location_id, v_target,
    jsonb_build_object('task_number', task.task_number, 'move_task_number', v_move_number));

  return jsonb_build_object('move_task_id', v_move_id, 'move_task_number', v_move_number);
end;
$$;

create or replace function public.cancel_replenishment_task(p_task_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare task public.replenishment_tasks%rowtype;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'warehouse_supervisor') then raise exception 'Not authorized'; end if;
  select * into task from public.replenishment_tasks where id = p_task_id for update;
  if not found then raise exception 'Replenishment task not found'; end if;
  if not public.can_access_warehouse(task.warehouse_id) then raise exception 'Not authorized for this warehouse'; end if;
  if task.status in ('completed', 'cancelled') then return; end if;

  if task.move_task_id is not null then
    update public.move_tasks set status = 'cancelled' where id = task.move_task_id and status in ('queued', 'assigned', 'in_progress');
  end if;
  update public.replenishment_tasks set status = 'cancelled', completed_at = now() where id = task.id;
  perform public.log_audit_event('replenishment_task_cancelled', 'replenishment_tasks', task.id, task.warehouse_id, null, null, null,
    jsonb_build_object('task_number', task.task_number));
end;
$$;

-- The move closes the replenishment. Completed: the task completes, and the
-- face slot gets the SKU with its new fill quantity (stock now in the face).
-- Cancelled: the task goes back to the queue for the next person.
create or replace function public.sync_replenishment_from_move()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status is distinct from old.status then
    if new.status = 'completed' then
      for r in
        update public.replenishment_tasks set status = 'completed', completed_at = coalesce(new.completed_at, now())
        where move_task_id = new.id and status not in ('completed', 'cancelled')
        returning product_id, warehouse_id
      loop
        if exists (select 1 from public.locations where id = new.to_location_id and status = 'pick_face') then
          insert into public.pick_face_slots (location_id, product_id, warehouse_id, full_quantity, filled_at)
          values (new.to_location_id, r.product_id, r.warehouse_id, public.pick_face_on_hand(new.to_location_id, r.product_id), now())
          on conflict (location_id, product_id) do update
            set full_quantity = excluded.full_quantity, filled_at = excluded.filled_at;
        end if;
      end loop;
    elsif new.status = 'cancelled' then
      update public.replenishment_tasks set status = 'queued', move_task_id = null, assigned_user_id = null
      where move_task_id = new.id and status not in ('completed', 'cancelled');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_replenishment_from_move on public.move_tasks;
create trigger sync_replenishment_from_move
  after update of status on public.move_tasks
  for each row execute function public.sync_replenishment_from_move();

revoke all on function public.product_daily_use(uuid, uuid) from public, anon;
revoke all on function public.replenishment_policy(uuid, uuid) from public, anon;
revoke all on function public.pick_face_on_hand(uuid, uuid) from public, anon;
revoke all on function public.open_fulfillment_demand(uuid) from public, anon;
revoke all on function public.pick_face_demand(uuid, uuid) from public, anon;
revoke all on function public.replenishment_source_pallet(uuid, uuid, uuid[]) from public, anon;
revoke all on function public.pick_face_target(uuid, uuid) from public, anon;
revoke all on function public.evaluate_forward_pick_replenishment(uuid) from public, anon;
revoke all on function public.request_urgent_replenishment(uuid, uuid, text) from public, anon;
revoke all on function public.make_pick_face(uuid, integer) from public, anon;
revoke all on function public.release_pick_face(uuid, text) from public, anon;
revoke all on function public.start_replenishment_task(uuid) from public, anon;
revoke all on function public.cancel_replenishment_task(uuid) from public, anon;
revoke all on function public.sync_replenishment_from_move() from public, anon;
grant execute on function public.product_daily_use(uuid, uuid) to authenticated, service_role;
grant execute on function public.replenishment_policy(uuid, uuid) to authenticated, service_role;
grant execute on function public.pick_face_on_hand(uuid, uuid) to authenticated, service_role;
grant execute on function public.open_fulfillment_demand(uuid) to authenticated, service_role;
grant execute on function public.pick_face_demand(uuid, uuid) to authenticated, service_role;
grant execute on function public.replenishment_source_pallet(uuid, uuid, uuid[]) to authenticated, service_role;
grant execute on function public.pick_face_target(uuid, uuid) to authenticated, service_role;
grant execute on function public.evaluate_forward_pick_replenishment(uuid) to authenticated, service_role;
grant execute on function public.request_urgent_replenishment(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.make_pick_face(uuid, integer) to authenticated, service_role;
grant execute on function public.release_pick_face(uuid, text) to authenticated, service_role;
grant execute on function public.start_replenishment_task(uuid) to authenticated, service_role;
grant execute on function public.cancel_replenishment_task(uuid) to authenticated, service_role;

-- ============================================================
-- Pick face status view (for the Replenishment page): one row per face and
-- SKU in it, and one row for each empty face.
-- ============================================================
create or replace view public.pick_face_status
with (security_invoker = true) as
with faces as (
  select l.id as location_id, l.warehouse_id, l.code as location_code, l.max_pallets, l.pick_sequence, z.code as zone_code
  from public.locations l
  left join public.zones z on z.id = l.zone_id
  where l.status = 'pick_face'
),
items as (
  select s.location_id, s.product_id from public.pick_face_slots s
  union
  select ib.location_id, ib.product_id from public.inventory_balances ib
  join faces f on f.location_id = ib.location_id
  where ib.status = 'available' and ib.available_quantity > 0 and ib.product_id is not null
  union
  select t.to_location_id, t.product_id from public.replenishment_tasks t
  join faces f on f.location_id = t.to_location_id
  where t.status in ('queued', 'assigned', 'in_progress') and t.product_id is not null
)
select
  f.location_id,
  f.warehouse_id,
  w.code as warehouse_code,
  f.location_code,
  f.zone_code,
  f.max_pallets,
  f.pick_sequence,
  (select count(distinct ib.pallet_id) from public.inventory_balances ib
    where ib.location_id = f.location_id and ib.quantity > 0
      and ib.status::text not in ('picked', 'shipped', 'in_transit', 'missing')) as pallets_in_face,
  i.product_id,
  p.sku,
  p.name as product_name,
  pol.daily_use,
  pol.basis as policy_basis,
  pol.trigger_pct,
  pol.pallets as reorder_pallets,
  s.full_quantity,
  s.filled_at,
  case when i.product_id is null then 0 else public.pick_face_on_hand(f.location_id, i.product_id) end as on_hand_quantity,
  case when i.product_id is null then 0 else public.pick_face_demand(f.warehouse_id, i.product_id) end as demand_quantity,
  (select count(*) from public.replenishment_tasks t
    where t.to_location_id = f.location_id and t.product_id = i.product_id
      and t.status in ('queued', 'assigned', 'in_progress')) as pallets_coming
from faces f
join public.warehouses w on w.id = f.warehouse_id
left join items i on i.location_id = f.location_id
left join public.products p on p.id = i.product_id
left join public.pick_face_slots s on s.location_id = f.location_id and s.product_id = i.product_id
left join lateral public.replenishment_policy(i.product_id, f.warehouse_id) pol on true;

grant select on public.pick_face_status to authenticated;

-- ============================================================
-- Schedule: the check runs each 5 minutes, as the order poll does (D2).
-- ============================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- cron.schedule(name, ...) replaces a job of the same name, so no cron.job read is needed.
    perform cron.schedule(
      'evaluate-forward-pick-replenishment',
      '*/5 * * * *',
      $job$select public.evaluate_forward_pick_replenishment(null)$job$
    );
  end if;
end $$;
