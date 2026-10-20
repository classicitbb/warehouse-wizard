-- Additive, invoker-rights API: existing table RLS and privileges remain authoritative.
-- Preview and commit use the same plan. A changed plan requires operator review again.
create or replace function public.inventory_whole_pallet_pick_work(
  in_warehouse_id uuid,
  in_balance_ids uuid[],
  in_mode text default 'pallet',
  in_commit boolean default false,
  in_choice text default 'selected',
  in_token text default null,
  in_pick_list_id uuid default null,
  in_order_number text default null
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  source_rows jsonb;
  candidates jsonb;
  selected_rows jsonb;
  recommended_rows jsonb;
  plan jsonb;
  chosen jsonb;
  item jsonb;
  owner_row record;
  list_row public.pick_lists%rowtype;
  order_row public.orders%rowtype;
  line_id uuid;
  result_lists jsonb := '[]'::jsonb;
  owner_count integer;
  suffix integer := 0;
begin
  if auth.uid() is null or not public.is_approved() or not public.can_access_warehouse(in_warehouse_id) then
    raise exception 'Not authorized for this warehouse.';
  end if;
  if in_mode not in ('pallet', 'product') or in_choice not in ('selected', 'recommended')
     or coalesce(cardinality(in_balance_ids), 0) = 0 then
    raise exception 'Choose at least one pallet and a valid selection mode.';
  end if;
  if in_mode = 'product' and cardinality(in_balance_ids) <> 1 then
    raise exception 'This product chooses exactly one whole pallet.';
  end if;

  if in_commit then
    -- Serialize with task inserts from other workflows too. No stock is deducted here.
    -- Fixed lock order; locks are held until this transaction commits or rolls back.
    lock table public.pick_tasks in share row exclusive mode;
    lock table public.inventory_freezes in share mode;
    perform b.id from public.inventory_balances b
      where b.warehouse_id = in_warehouse_id order by b.id for update;
    perform p.id from public.pallets p
      where p.current_warehouse_id = in_warehouse_id order by p.id for update;
    perform l.id from public.locations l
      where l.warehouse_id = in_warehouse_id order by l.id for share;
    perform pr.id from public.products pr where pr.id in (
      select b.product_id from public.inventory_balances b where b.id = any(in_balance_ids)
    ) order by pr.id for share;
    perform il.id from public.inventory_lots il where il.id in (
      select b.inventory_lot_id from public.inventory_balances b where b.warehouse_id = in_warehouse_id
    ) order by il.id for share;
  end if;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) into source_rows
  from public.inventory_balances b where b.id = any(in_balance_ids) and b.warehouse_id = in_warehouse_id;
  if jsonb_array_length(source_rows) <> (select count(distinct x) from unnest(in_balance_ids) x) then
    raise exception 'A selected pallet is missing or outside the active warehouse. Refresh inventory.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.product_id, c.client_id nulls last,
    case when c.rotation_method = 'fefo' then c.expiry_date end nulls last,
    c.received_at nulls last, c.pallet_id, c.inventory_balance_id), '[]'::jsonb) into candidates
  from (
    select b.id as inventory_balance_id, b.pallet_id, p.pallet_code, b.product_id, pr.sku,
      b.client_id, b.location_id, l.code as location_code, b.quantity,
      b.received_at, coalesce(il.expiry_date, b.expiry_date) as expiry_date, pr.rotation_method
    from public.inventory_balances b
    join public.pallets p on p.id = b.pallet_id
    join public.products pr on pr.id = b.product_id
    join public.locations l on l.id = b.location_id
    left join public.inventory_lots il on il.id = b.inventory_lot_id
    where b.warehouse_id = in_warehouse_id
      and exists (select 1 from jsonb_array_elements(source_rows) s
        where (s->>'product_id')::uuid = b.product_id
          and (s->>'client_id')::uuid is not distinct from b.client_id)
      and p.product_id = b.product_id and p.client_id is not distinct from b.client_id
      and pr.active and not pr.is_hidden
      and (pr.client_owner_id is null or pr.client_owner_id = b.client_id)
      and p.current_warehouse_id = b.warehouse_id and p.current_location_id = b.location_id
      and l.warehouse_id = b.warehouse_id and l.status = 'active'
      and b.status = 'available' and p.status = 'available'
      and b.quantity > 0 and b.available_quantity = b.quantity
      and p.quantity = b.quantity and p.available_quantity = b.quantity
      and b.reserved_quantity = 0 and b.held_quantity = 0 and b.damaged_quantity = 0
      and p.reserved_quantity = 0 and p.held_quantity = 0 and p.damaged_quantity = 0
      and coalesce(b.correction_state, 'active') not in ('pending', 'superseded')
      and coalesce(p.correction_state, 'active') not in ('pending', 'superseded')
      and not exists (select 1 from public.inventory_freezes f where f.warehouse_id = b.warehouse_id
        and f.status = 'active' and (f.location_id = b.location_id or f.pallet_id = b.pallet_id
          or (f.location_id is null and f.pallet_id is null)))
      and not exists (select 1 from public.pick_tasks t where t.pallet_id = b.pallet_id
        and t.status not in ('completed', 'cancelled'))
  ) c;

  select coalesce(jsonb_agg(c order by ord), '[]'::jsonb) into selected_rows
  from jsonb_array_elements(candidates) with ordinality t(c, ord)
  where (c->>'inventory_balance_id')::uuid = any(in_balance_ids);
  if in_mode = 'pallet' and jsonb_array_length(selected_rows) <> jsonb_array_length(source_rows) then
    raise exception 'A selected pallet is no longer eligible (reserved, blocked, frozen, moved or changed). Refresh inventory; no work was added.';
  end if;

  -- Top N per product AND owner, never quantity allocation. Keep matching selected
  -- pallets in the top-N set, so alternatives are unique even for overlapping choices.
  select coalesce(jsonb_agg(c order by ord), '[]'::jsonb) into recommended_rows from (
    select c, ord, row_number() over (partition by c->>'product_id', c->>'client_id' order by ord) as rank
    from jsonb_array_elements(candidates) with ordinality t(c, ord)
  ) ranked where rank <= (select count(*) from jsonb_array_elements(source_rows) s
    where s->>'product_id' = c->>'product_id' and s->>'client_id' is not distinct from c->>'client_id');
  if jsonb_array_length(recommended_rows) <> jsonb_array_length(source_rows) then
    raise exception 'Not enough eligible whole pallets remain. Refresh inventory; no work was added.';
  end if;
  if in_mode = 'product' then selected_rows := recommended_rows; end if;
  plan := jsonb_build_object('selected', selected_rows, 'recommended', recommended_rows,
    'warning', selected_rows <> recommended_rows);
  -- Include source/candidate evidence: a moved pallet or new earlier stock invalidates review.
  plan := plan || jsonb_build_object('token', md5((plan || jsonb_build_object('sources', source_rows,
    'candidates', candidates, 'warehouse', in_warehouse_id, 'mode', in_mode))::text));
  if not in_commit then return plan; end if;
  if in_token is distinct from plan->>'token' then
    raise exception 'Availability or rotation changed since review. Refresh the preview; no work was added.';
  end if;
  chosen := case when in_choice = 'recommended' then recommended_rows else selected_rows end;
  select count(distinct coalesce(c->>'client_id', 'none')) into owner_count from jsonb_array_elements(chosen) c;
  if in_pick_list_id is not null and owner_count <> 1 then
    raise exception 'Choose a new list for pallets with different owners.';
  end if;
  if in_pick_list_id is null and coalesce(length(trim(in_order_number)), 0) < 2 then
    raise exception 'An order number is required for a new list.';
  end if;

  for owner_row in select distinct (c->>'client_id')::uuid as client_id from jsonb_array_elements(chosen) c loop
    suffix := suffix + 1;
    if in_pick_list_id is not null then
      select * into list_row from public.pick_lists where id = in_pick_list_id for update;
      if not found or list_row.status <> 'queued' or list_row.warehouse_id <> in_warehouse_id
        or list_row.client_id is distinct from owner_row.client_id or list_row.transfer_id is not null
        or list_row.order_id is null then
        raise exception 'Pick list is no longer eligible. Choose a queued list for this warehouse and owner.';
      end if;
      select * into order_row from public.orders where id = list_row.order_id for update;
      if not found or order_row.status not in ('draft', 'queued')
        or order_row.warehouse_id <> in_warehouse_id or order_row.client_id is distinct from owner_row.client_id then
        raise exception 'The list order is no longer eligible.';
      end if;
    else
      insert into public.orders(order_number, client_id, warehouse_id, status, created_by, notes)
      values (trim(in_order_number) || case when owner_count > 1 then '-' || suffix else '' end,
        owner_row.client_id, in_warehouse_id, 'queued', auth.uid(), 'Whole pallets from Inventory Search')
      returning * into order_row;
      insert into public.pick_lists(pick_list_number, warehouse_id, client_id, order_id, status, released_at, created_by)
      values ('PKL-' || gen_random_uuid()::text, in_warehouse_id, owner_row.client_id, order_row.id,
        'queued', now(), auth.uid()) returning * into list_row;
      insert into public.barcode_labels(label_type, entity_id, label_code)
      values ('pick_list', list_row.id, list_row.pick_list_number);
    end if;
    for item in select c from jsonb_array_elements(chosen) c
      where (c->>'client_id')::uuid is not distinct from owner_row.client_id loop
      insert into public.order_lines(order_id, product_id, quantity, created_by)
      values (order_row.id, (item->>'product_id')::uuid, (item->>'quantity')::numeric, auth.uid()) returning id into line_id;
      insert into public.pick_tasks(task_number, pick_list_id, order_line_id, pallet_id, location_id, requested_quantity, status, created_by)
      values ('PKT-' || gen_random_uuid()::text, list_row.id, line_id, (item->>'pallet_id')::uuid,
        (item->>'location_id')::uuid, (item->>'quantity')::numeric, 'queued', auth.uid());
    end loop;
    update public.pick_lists set consolidated = (select count(*) > 1 from public.pick_tasks where pick_list_id = list_row.id)
      where id = list_row.id;
    result_lists := result_lists || jsonb_build_array(jsonb_build_object('id', list_row.id, 'pick_list_number', list_row.pick_list_number));
  end loop;
  return plan || jsonb_build_object('lists', result_lists);
end;
$$;

-- Protect the shared workflow too: a legacy creator that read candidates before
-- this transaction committed must not subsequently direct the same pallet again.
-- A trigger avoids assuming historical data is already clean enough for a unique
-- index. It leaves historical rows untouched and uses existing invoker visibility.
create or replace function public.guard_one_open_pick_per_pallet()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.pallet_id is not null and new.status not in ('completed', 'cancelled') then
    perform pg_advisory_xact_lock(hashtextextended(new.pallet_id::text, 0));
    if exists (select 1 from public.pick_tasks t where t.pallet_id = new.pallet_id
      and t.id <> new.id and t.status not in ('completed', 'cancelled')) then
      raise exception 'This pallet already has open pick work. Refresh inventory; no duplicate task was added.';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_one_open_pick_per_pallet
before insert or update of pallet_id, status on public.pick_tasks
for each row execute function public.guard_one_open_pick_per_pallet();

-- Append an effective expiry without changing existing view column types/order.
create or replace view public.inventory_search_view with (security_invoker = true) as
select
  ib.id as inventory_balance_id, ib.warehouse_id, ib.product_id, ib.client_id, ib.location_id,
  p.id as pallet_id, p.pallet_code, p.pallet_barcode,
  r.container_number, r.po_number, pr.sku, pr.name as product_name, pr.barcode as product_barcode,
  c.code as client_code, c.name as client_name, il.lot_number, il.batch_number, il.expiry_date, il.manufacture_date,
  w.code as warehouse_code, w.name as warehouse_name, z.code as zone_code, z.name as zone_name, l.code as location_code,
  ib.status, ib.quantity, ib.available_quantity, ib.reserved_quantity, ib.held_quantity, ib.damaged_quantity, ib.received_at,
  p.length, p.width, p.height, p.weight, pr.temperature_requirement, pr.product_family, pr.rotation_method,
  p.correction_state as pallet_correction_state, ib.correction_state,
  coalesce(il.expiry_date, ib.expiry_date) as rotation_expiry_date
from public.inventory_balances ib
join public.pallets p on p.id = ib.pallet_id
join public.products pr on pr.id = ib.product_id
left join public.receipt_lines rl on rl.id = p.receipt_line_id
left join public.receipts r on r.id = rl.receipt_id
left join public.clients c on c.id = ib.client_id
left join public.inventory_lots il on il.id = ib.inventory_lot_id
join public.warehouses w on w.id = ib.warehouse_id
left join public.zones z on z.id = ib.zone_id
left join public.locations l on l.id = ib.location_id;
