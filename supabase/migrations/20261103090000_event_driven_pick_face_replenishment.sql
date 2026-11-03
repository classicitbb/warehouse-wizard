-- Event-driven forward-pick replenishment.
--
-- A replenishment task now appears the moment a pick face drops, not at the
-- next 5-minute check. The whole-warehouse check stays as a slow safety net
-- (hourly). Thresholds, the 30-day learning window and the audit events are
-- unchanged: the same per-product logic runs, only more often and only for
-- the product that changed.
--
--   1. replenish_product_in_warehouse(warehouse, product) holds the logic that
--      evaluate_forward_pick_replenishment used to run inline for each product.
--      The whole-warehouse check now loops over it.
--   2. evaluate_pick_face_replenishment(product, location) evaluates one pick
--      face's product after an event.
--   3. Statement-level AFTER triggers call it when: stock leaves a pick face
--      (inventory_balances), a pick task completes or is shorted, a pick list
--      is released, fulfillment lines arrive (demand), or a face's fill
--      quantity is edited.
--   4. De-duplication: the evaluator counts the product's open tasks before it
--      creates one, and an advisory lock per product makes two events on the
--      same product run one after the other, so repeated picks never create a
--      duplicate task.
--   5. Failure isolation: every trigger body catches errors and writes them to
--      system_logs. A replenishment failure never blocks a pick confirmation.
--   6. The cron job moves from every 5 minutes to hourly.
--
-- Additive only.

-- ============================================================
-- Demand for one product (cheaper than the whole warehouse per product)
-- ============================================================
create or replace function public.open_fulfillment_demand(p_warehouse_id uuid, p_product_id uuid)
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
    and (p_product_id is null or ofl.product_id = p_product_id)
  group by f.warehouse_id, ofl.product_id
  having sum(greatest(ofl.quantity - coalesce(pk.picked, 0), 0)) > 0;
$$;

create or replace function public.open_fulfillment_demand(p_warehouse_id uuid default null)
returns table (warehouse_id uuid, product_id uuid, quantity numeric)
language sql stable security definer set search_path = public as $$
  select * from public.open_fulfillment_demand(p_warehouse_id, null::uuid);
$$;

create or replace function public.pick_face_demand(p_warehouse_id uuid, p_product_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(d.quantity) from public.open_fulfillment_demand(p_warehouse_id, p_product_id) d), 0);
$$;

-- ============================================================
-- Failure log and recursion flag
-- ============================================================

-- Writes to system_logs and never raises, so it is safe inside a handler.
create or replace function public.replen_log_failure(p_source text, p_message text, p_details jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.system_logs (log_type, severity, title, message, details, source, created_by)
  values ('error', 'error', 'Event-driven replenishment failed', p_message, p_details, p_source, auth.uid());
exception when others then
  null;
end;
$$;

-- False while an evaluation runs in this transaction, so stock or slot writes
-- made by the evaluator (or by the move that a task starts) do not fire it again.
create or replace function public.replen_events_enabled()
returns boolean language sql stable set search_path = public as $$
  select coalesce(current_setting('ww.replen_eval', true), '') <> '1';
$$;

-- ============================================================
-- The per-product evaluation (was the body of the whole-warehouse loop)
-- ============================================================
create or replace function public.replenish_product_in_warehouse(p_warehouse_id uuid, p_product_id uuid)
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
  -- One evaluation per product at a time: a second event waits, then sees the
  -- first one's tasks and does not duplicate them.
  perform pg_advisory_xact_lock(hashtextextended('replenish:' || p_warehouse_id::text || ':' || p_product_id::text, 0));
  perform set_config('ww.replen_eval', '1', true);

  -- Only warehouses with pick faces are evaluated.
  if not exists (select 1 from public.locations l where l.warehouse_id = p_warehouse_id and l.status = 'pick_face') then
    perform set_config('ww.replen_eval', '', true);
    return jsonb_build_object('created', 0, 'updated', 0, 'cancelled', 0, 'released', 0);
  end if;

  -- Stock already on a face with no slot (a bin converted with stock in it):
  -- its fill is what is there now. Stock above the fill raises the fill.
  insert into public.pick_face_slots (location_id, product_id, warehouse_id, full_quantity)
  select ib.location_id, ib.product_id, l.warehouse_id, sum(ib.available_quantity)
  from public.inventory_balances ib
  join public.locations l on l.id = ib.location_id
  where l.status = 'pick_face' and ib.status = 'available' and ib.available_quantity > 0
    and ib.product_id = p_product_id and l.warehouse_id = p_warehouse_id
  group by ib.location_id, ib.product_id, l.warehouse_id
  on conflict (location_id, product_id) do update
    set full_quantity = greatest(public.pick_face_slots.full_quantity, excluded.full_quantity);

  select
    (fs.slots > 0) as on_face,
    coalesce(fs.on_hand, 0) as on_hand,
    coalesce(fs.full_quantity, 0) as full_quantity,
    public.pick_face_demand(p_warehouse_id, p_product_id) as demand,
    pol.trigger_pct, pol.pallets,
    (select max(ib.available_quantity)
       from public.inventory_balances ib
       join public.locations bl on bl.id = ib.location_id and bl.status = 'active'
       where ib.warehouse_id = p_warehouse_id and ib.product_id = p_product_id and ib.status = 'available') as full_pallet,
    exists (
      select 1 from public.replenishment_tasks t
      where t.warehouse_id = p_warehouse_id and t.product_id = p_product_id
        and t.status in ('queued', 'assigned', 'in_progress', 'exception')
    ) as has_open_task
  into item
  from (
    select count(*) as slots, sum(s.full_quantity) as full_quantity,
           sum(public.pick_face_on_hand(s.location_id, s.product_id)) as on_hand
    from public.pick_face_slots s
    join public.locations l on l.id = s.location_id and l.status = 'pick_face'
    where s.warehouse_id = p_warehouse_id and s.product_id = p_product_id
  ) fs
  left join lateral public.replenishment_policy(p_product_id, p_warehouse_id) pol on true;

  -- Nothing on a face, no open demand, no open task: nothing to decide.
  if not (item.on_face or item.demand > 0 or item.has_open_task) or item.trigger_pct is null then
    perform set_config('ww.replen_eval', '', true);
    return jsonb_build_object('created', 0, 'updated', 0, 'cancelled', 0, 'released', 0);
  end if;

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
    where warehouse_id = p_warehouse_id and product_id = p_product_id
      and status in ('queued', 'exception') and move_task_id is null and reason in ('min', 'demand');
    get diagnostics v_count = row_count;
    v_cancelled := v_cancelled + v_count;
  else
    v_priority := case when v_projected < 0 then 'urgent' else 'normal' end;
    v_reason := case when item.on_hand <= v_level then 'min' else 'demand' end;
    v_cover := greatest(-v_projected, 0);

    -- Refresh the numbers on the open tasks. A short or count task stays urgent.
    update public.replenishment_tasks set
      on_hand_quantity = item.on_hand,
      demand_quantity = item.demand,
      reorder_point = v_level,
      priority = case when reason in ('short', 'count_variance') then 'urgent' else v_priority end
    where warehouse_id = p_warehouse_id and product_id = p_product_id
      and status in ('queued', 'assigned', 'in_progress', 'exception')
      and (on_hand_quantity, demand_quantity, reorder_point, priority)
          is distinct from (item.on_hand, item.demand, v_level, case when reason in ('short', 'count_variance') then 'urgent' else v_priority end);
    get diagnostics v_count = row_count;
    v_updated := v_updated + v_count;

    select count(*), coalesce(sum(t.target_quantity), 0) into v_open, v_covered
    from public.replenishment_tasks t
    where t.warehouse_id = p_warehouse_id and t.product_id = p_product_id
      and t.status in ('queued', 'assigned', 'in_progress');

    v_exclude := '{}';
    v_guard := 0;
    while (v_open < item.pallets or v_covered < v_cover) and v_guard < 10 loop
      v_guard := v_guard + 1;
      select * into src from public.replenishment_source_pallet(p_warehouse_id, p_product_id, v_exclude);
      v_target := case when src.pallet_id is null then null else public.pick_face_target(p_warehouse_id, p_product_id) end;
      v_note := case
        when src.pallet_id is null then 'No bulk stock to replenish from.'
        when v_target is null then 'No pick face has room. Make a pick face or free a place.'
      end;

      select * into v_exception from public.replenishment_tasks t
      where t.warehouse_id = p_warehouse_id and t.product_id = p_product_id
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
            p_warehouse_id, p_product_id, v_level, 0, item.on_hand, item.demand,
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
          p_warehouse_id, p_product_id, v_target, src.location_id, src.pallet_id,
          v_level, src.available_quantity, item.on_hand, item.demand, v_priority, v_reason, 'queued'
        );
        v_created := v_created + 1;
      end if;

      v_exclude := v_exclude || src.pallet_id;
      v_open := v_open + 1;
      v_covered := v_covered + src.available_quantity;
    end loop;
  end if;

  -- Free this product's face slots that have no stock and no open task.
  delete from public.pick_face_slots s
  where s.warehouse_id = p_warehouse_id and s.product_id = p_product_id
    and public.pick_face_on_hand(s.location_id, s.product_id) = 0
    and not exists (
      select 1 from public.replenishment_tasks t
      where t.to_location_id = s.location_id and t.product_id = s.product_id
        and t.status in ('queued', 'assigned', 'in_progress')
    );
  get diagnostics v_released = row_count;

  perform set_config('ww.replen_eval', '', true);
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'cancelled', v_cancelled, 'released', v_released);
end;
$$;

-- ============================================================
-- Whole-warehouse check (the safety net and the Check now button): loops
-- over the per-product evaluation. Same results as before.
-- ============================================================
create or replace function public.evaluate_forward_pick_replenishment(p_warehouse_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k record;
  r jsonb;
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

  for k in
    with wh as (
      select distinct l.warehouse_id
      from public.locations l
      where l.status = 'pick_face'
        and (p_warehouse_id is null or l.warehouse_id = p_warehouse_id)
        and (auth.uid() is null or public.can_access_warehouse(l.warehouse_id))
    ),
    keys as (
      select s.warehouse_id, s.product_id, true as on_face
      from public.pick_face_slots s
      join public.locations l on l.id = s.location_id and l.status = 'pick_face'
      where s.warehouse_id in (select warehouse_id from wh)
      union
      select l.warehouse_id, ib.product_id, true
      from public.inventory_balances ib
      join public.locations l on l.id = ib.location_id and l.status = 'pick_face'
      where ib.status = 'available' and ib.available_quantity > 0 and ib.product_id is not null
        and l.warehouse_id in (select warehouse_id from wh)
      union
      select d.warehouse_id, d.product_id, false
      from public.open_fulfillment_demand(p_warehouse_id) d
      where d.warehouse_id in (select warehouse_id from wh)
      union
      select t.warehouse_id, t.product_id, false
      from public.replenishment_tasks t
      where t.status in ('queued', 'assigned', 'in_progress', 'exception')
        and t.warehouse_id in (select warehouse_id from wh) and t.product_id is not null
    ),
    ranked as (
      select kk.warehouse_id, kk.product_id, bool_or(kk.on_face) as on_face
      from keys kk group by kk.warehouse_id, kk.product_id
    )
    select ranked.warehouse_id, ranked.product_id
    from ranked
    left join lateral (
      select sum(d.quantity) as quantity from public.open_fulfillment_demand(ranked.warehouse_id, ranked.product_id) d
    ) dm on true
    -- Products already on a face get the free places first.
    order by ranked.on_face desc, coalesce(dm.quantity, 0) desc
  loop
    r := public.replenish_product_in_warehouse(k.warehouse_id, k.product_id);
    v_created := v_created + (r->>'created')::int;
    v_updated := v_updated + (r->>'updated')::int;
    v_cancelled := v_cancelled + (r->>'cancelled')::int;
    v_released := v_released + (r->>'released')::int;
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
  get diagnostics r = row_count;
  v_released := v_released + coalesce((r #>> '{}')::int, 0);

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'cancelled', v_cancelled, 'released', v_released);
end;
$$;

-- ============================================================
-- Targeted evaluator: one product at one pick face
-- ============================================================
create or replace function public.evaluate_pick_face_replenishment(p_product_id uuid, p_location_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_warehouse uuid;
begin
  select l.warehouse_id into v_warehouse
  from public.locations l where l.id = p_location_id and l.status = 'pick_face';
  if v_warehouse is null or p_product_id is null then
    return jsonb_build_object('created', 0, 'updated', 0, 'cancelled', 0, 'released', 0);
  end if;
  return public.replenish_product_in_warehouse(v_warehouse, p_product_id);
end;
$$;

-- Runs one evaluation inside a sub-transaction: an error rolls back only the
-- evaluation, is logged, and is not raised.
create or replace function public.replen_evaluate_safe(p_warehouse_id uuid, p_product_id uuid, p_source text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.replenish_product_in_warehouse(p_warehouse_id, p_product_id);
exception when others then
  perform public.replen_log_failure(p_source, sqlerrm,
    jsonb_build_object('warehouse_id', p_warehouse_id, 'product_id', p_product_id, 'sqlstate', sqlstate));
end;
$$;

-- ============================================================
-- Triggers. Statement-level, after the change is saved, in the same
-- transaction. Each body catches its own errors (failure isolation) and
-- skips while an evaluation runs (recursion guard).
-- ============================================================

-- Stock leaves a pick face: quantity or available quantity drops, or the
-- balance moves out of the face.
create or replace function public.replen_on_balance_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.replen_events_enabled() then return null; end if;
  for r in
    select distinct l.warehouse_id, o.product_id
    from old_rows o
    join new_rows n on n.id = o.id
    join public.locations l on l.id = o.location_id and l.status = 'pick_face'
    where o.product_id is not null
      and (n.location_id is distinct from o.location_id
           or n.available_quantity < o.available_quantity
           or n.quantity < o.quantity)
    order by 2
  loop
    perform public.replen_evaluate_safe(r.warehouse_id, r.product_id, 'replen_on_balance_update');
  end loop;
  return null;
exception when others then
  perform public.replen_log_failure('replen_on_balance_update', sqlerrm, jsonb_build_object('sqlstate', sqlstate));
  return null;
end;
$$;

create or replace function public.replen_on_balance_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.replen_events_enabled() then return null; end if;
  for r in
    select distinct l.warehouse_id, o.product_id
    from old_rows o
    join public.locations l on l.id = o.location_id and l.status = 'pick_face'
    where o.product_id is not null
    order by 2
  loop
    perform public.replen_evaluate_safe(r.warehouse_id, r.product_id, 'replen_on_balance_delete');
  end loop;
  return null;
exception when others then
  perform public.replen_log_failure('replen_on_balance_delete', sqlerrm, jsonb_build_object('sqlstate', sqlstate));
  return null;
end;
$$;

drop trigger if exists replen_balance_update on public.inventory_balances;
create trigger replen_balance_update
  after update on public.inventory_balances
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.replen_on_balance_update();

drop trigger if exists replen_balance_delete on public.inventory_balances;
create trigger replen_balance_delete
  after delete on public.inventory_balances
  referencing old table as old_rows
  for each statement execute function public.replen_on_balance_delete();

-- A pick task completes or is shorted (short pick: confirmed below requested).
create or replace function public.replen_on_pick_task_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.replen_events_enabled() then return null; end if;
  for r in
    select distinct pl.warehouse_id, coalesce(ofl.product_id, ol.product_id, p.product_id) as product_id
    from new_rows n
    join old_rows o on o.id = n.id
    join public.pick_lists pl on pl.id = n.pick_list_id
    left join public.order_fulfillment_lines ofl on ofl.id = n.fulfillment_line_id
    left join public.order_lines ol on ol.id = n.order_line_id
    left join public.pallets p on p.id = n.pallet_id
    where (n.status = 'completed' and o.status is distinct from 'completed')
       or (n.short_reason is not null and n.short_reason is distinct from o.short_reason)
       or n.confirmed_quantity is distinct from o.confirmed_quantity
    order by 2
  loop
    if r.product_id is not null then
      perform public.replen_evaluate_safe(r.warehouse_id, r.product_id, 'replen_on_pick_task_update');
    end if;
  end loop;
  return null;
exception when others then
  perform public.replen_log_failure('replen_on_pick_task_update', sqlerrm, jsonb_build_object('sqlstate', sqlstate));
  return null;
end;
$$;

drop trigger if exists replen_pick_task_update on public.pick_tasks;
create trigger replen_pick_task_update
  after update on public.pick_tasks
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.replen_on_pick_task_update();

-- A pick list is released (inserted released, or just made released): its
-- products are demand now. Tasks may not exist yet, so the products come from
-- the tasks, the fulfillment lines and the order lines.
create or replace function public.replen_pick_list_products(p_list_ids uuid[])
returns table (warehouse_id uuid, product_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct x.warehouse_id, x.product_id
  from (
    select pl.warehouse_id, coalesce(ofl.product_id, ol.product_id, p.product_id) as product_id
    from public.pick_lists pl
    join public.pick_tasks pt on pt.pick_list_id = pl.id
    left join public.order_fulfillment_lines ofl on ofl.id = pt.fulfillment_line_id
    left join public.order_lines ol on ol.id = pt.order_line_id
    left join public.pallets p on p.id = pt.pallet_id
    where pl.id = any (p_list_ids)
    union
    select pl.warehouse_id, ofl.product_id
    from public.pick_lists pl
    join public.order_fulfillment_lines ofl on ofl.fulfillment_id = pl.fulfillment_id
    where pl.id = any (p_list_ids)
    union
    select pl.warehouse_id, ol.product_id
    from public.pick_lists pl
    join public.order_lines ol on ol.order_id = pl.order_id
    where pl.id = any (p_list_ids)
  ) x
  where x.product_id is not null
  order by 2;
$$;

create or replace function public.replen_on_pick_list_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_ids uuid[];
begin
  if not public.replen_events_enabled() then return null; end if;
  select array_agg(n.id) into v_ids from new_rows n where n.released_at is not null;
  for r in select * from public.replen_pick_list_products(coalesce(v_ids, '{}')) loop
    perform public.replen_evaluate_safe(r.warehouse_id, r.product_id, 'replen_on_pick_list_insert');
  end loop;
  return null;
exception when others then
  perform public.replen_log_failure('replen_on_pick_list_insert', sqlerrm, jsonb_build_object('sqlstate', sqlstate));
  return null;
end;
$$;

create or replace function public.replen_on_pick_list_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_ids uuid[];
begin
  if not public.replen_events_enabled() then return null; end if;
  select array_agg(n.id) into v_ids
  from new_rows n join old_rows o on o.id = n.id
  where n.released_at is not null and (o.released_at is null or o.status is distinct from n.status);
  for r in select * from public.replen_pick_list_products(coalesce(v_ids, '{}')) loop
    perform public.replen_evaluate_safe(r.warehouse_id, r.product_id, 'replen_on_pick_list_update');
  end loop;
  return null;
exception when others then
  perform public.replen_log_failure('replen_on_pick_list_update', sqlerrm, jsonb_build_object('sqlstate', sqlstate));
  return null;
end;
$$;

drop trigger if exists replen_pick_list_insert on public.pick_lists;
create trigger replen_pick_list_insert
  after insert on public.pick_lists
  referencing new table as new_rows
  for each statement execute function public.replen_on_pick_list_insert();

drop trigger if exists replen_pick_list_update on public.pick_lists;
create trigger replen_pick_list_update
  after update on public.pick_lists
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.replen_on_pick_list_update();

-- Demand arrives: fulfillment lines are inserted (a NetSuite import).
create or replace function public.replen_on_fulfillment_lines_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.replen_events_enabled() then return null; end if;
  for r in
    select distinct f.warehouse_id, n.product_id
    from new_rows n
    join public.order_fulfillments f on f.id = n.fulfillment_id
    where n.product_id is not null
    order by 2
  loop
    perform public.replen_evaluate_safe(r.warehouse_id, r.product_id, 'replen_on_fulfillment_lines_insert');
  end loop;
  return null;
exception when others then
  perform public.replen_log_failure('replen_on_fulfillment_lines_insert', sqlerrm, jsonb_build_object('sqlstate', sqlstate));
  return null;
end;
$$;

drop trigger if exists replen_fulfillment_lines_insert on public.order_fulfillment_lines;
create trigger replen_fulfillment_lines_insert
  after insert on public.order_fulfillment_lines
  referencing new table as new_rows
  for each statement execute function public.replen_on_fulfillment_lines_insert();

-- A face's fill quantity is edited by hand. pg_trigger_depth() = 1 keeps out
-- the slot writes that other triggers make (sync_replenishment_from_move) and
-- the evaluator's own (guarded by ww.replen_eval).
create or replace function public.replen_on_slot_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if pg_trigger_depth() > 1 or not public.replen_events_enabled() then return null; end if;
  for r in
    select distinct n.warehouse_id, n.product_id
    from new_rows n join old_rows o on o.location_id = n.location_id and o.product_id = n.product_id
    where n.full_quantity is distinct from o.full_quantity
    order by 2
  loop
    perform public.replen_evaluate_safe(r.warehouse_id, r.product_id, 'replen_on_slot_update');
  end loop;
  return null;
exception when others then
  perform public.replen_log_failure('replen_on_slot_update', sqlerrm, jsonb_build_object('sqlstate', sqlstate));
  return null;
end;
$$;

drop trigger if exists replen_slot_update on public.pick_face_slots;
create trigger replen_slot_update
  after update on public.pick_face_slots
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.replen_on_slot_update();

-- ============================================================
-- Grants: the new functions are internal (triggers and the whole-warehouse
-- check call them), so only service_role may execute them directly.
-- ============================================================
revoke all on function public.open_fulfillment_demand(uuid, uuid) from public, anon;
revoke all on function public.replen_log_failure(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.replen_events_enabled() from public, anon;
revoke all on function public.replenish_product_in_warehouse(uuid, uuid) from public, anon, authenticated;
revoke all on function public.evaluate_pick_face_replenishment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.replen_evaluate_safe(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.replen_pick_list_products(uuid[]) from public, anon, authenticated;
revoke all on function public.replen_on_balance_update() from public, anon, authenticated;
revoke all on function public.replen_on_balance_delete() from public, anon, authenticated;
revoke all on function public.replen_on_pick_task_update() from public, anon, authenticated;
revoke all on function public.replen_on_pick_list_insert() from public, anon, authenticated;
revoke all on function public.replen_on_pick_list_update() from public, anon, authenticated;
revoke all on function public.replen_on_fulfillment_lines_insert() from public, anon, authenticated;
revoke all on function public.replen_on_slot_update() from public, anon, authenticated;
grant execute on function public.open_fulfillment_demand(uuid, uuid) to authenticated, service_role;
grant execute on function public.replenish_product_in_warehouse(uuid, uuid) to service_role;
grant execute on function public.evaluate_pick_face_replenishment(uuid, uuid) to service_role;

-- ============================================================
-- Safety net: the whole-warehouse check runs hourly instead of every 5
-- minutes. Events do the real-time work; this catches anything missed.
-- ============================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- cron.schedule(name, ...) replaces a job of the same name.
    perform cron.schedule(
      'evaluate-forward-pick-replenishment',
      '0 * * * *',
      $job$select public.evaluate_forward_pick_replenishment(null)$job$
    );
  end if;
end $$;
