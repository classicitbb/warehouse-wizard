-- Pallet corrections create a replacement pallet while retaining the original
-- record for traceability.  The lightweight correction state avoids adding
-- transient workflow values to the shared inventory_status enum.
alter table public.pallets
  add column if not exists correction_state text
  check (correction_state is null or correction_state in ('pending', 'superseded'));

alter table public.inventory_balances
  add column if not exists correction_state text
  check (correction_state is null or correction_state in ('pending', 'superseded'));

create index if not exists pallets_correction_state_idx on public.pallets (correction_state) where correction_state is not null;
create index if not exists inventory_balances_correction_state_idx on public.inventory_balances (correction_state) where correction_state is not null;

create or replace function public.inventory_correction_code(in_prefix text)
returns text
language sql
volatile
set search_path = public
as $$
  select upper(in_prefix) || '-' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS') || upper(substr(md5(random()::text), 1, 4));
$$;

create or replace function public.begin_inventory_pallet_correction(in_inventory_balance_id uuid)
returns table(draft_id uuid, replacement_pallet_barcode text, former_location_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  balance_row public.inventory_balances%rowtype;
  pallet_row public.pallets%rowtype;
  location_row public.locations%rowtype;
  lot_row public.inventory_lots%rowtype;
  new_draft_id uuid;
  new_barcode text;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Inventory pallet corrections require Receiving permission.';
  end if;

  select * into balance_row from public.inventory_balances where id = in_inventory_balance_id for update;
  if not found then raise exception 'Inventory pallet was not found.'; end if;
  select * into pallet_row from public.pallets where id = balance_row.pallet_id for update;
  if not found then raise exception 'Pallet was not found.'; end if;
  if balance_row.correction_state is not null or pallet_row.correction_state is not null then
    raise exception 'This pallet already has a correction in progress or has been superseded.';
  end if;
  if not pallet_row.is_stored or pallet_row.current_location_id is null then
    raise exception 'Only a stored pallet can be returned to Receiving for correction.';
  end if;
  if balance_row.status <> 'available' or coalesce(balance_row.reserved_quantity, 0) > 0 or coalesce(pallet_row.reserved_quantity, 0) > 0 then
    raise exception 'Clear reserved or allocated stock before correcting this pallet.';
  end if;

  select * into location_row from public.locations where id = pallet_row.current_location_id;
  select * into lot_row from public.inventory_lots where id = pallet_row.inventory_lot_id;
  new_barcode := public.inventory_correction_code('PLT');

  insert into public.receipts (
    receipt_number, receipt_type, reference_number, warehouse_id, client_id,
    status, draft_pallet_barcode, notes
  ) values (
    public.inventory_correction_code('RCT'), 'other', new_barcode, balance_row.warehouse_id, balance_row.client_id,
    'draft', new_barcode,
    jsonb_build_object(
      '_draft', true,
      'source_type', 'inventory_pallet_correction',
      'source_label', 'Inventory pallet correction',
      'correction_source_pallet_id', pallet_row.id,
      'correction_source_balance_id', balance_row.id,
      'replacement_pallet_barcode', new_barcode,
      'former_location_id', pallet_row.current_location_id,
      'former_location_code', location_row.code,
      'product_id', pallet_row.product_id,
      'client_id', pallet_row.client_id,
      'quantity', balance_row.quantity,
      'expiry_date', lot_row.expiry_date,
      'lot_number', lot_row.lot_number,
      'batch_number', lot_row.batch_number,
      'inventory_lot_id', pallet_row.inventory_lot_id,
      'packaging_profile_id', pallet_row.packaging_profile_id,
      'original_pallet', jsonb_build_object(
        'status', pallet_row.status, 'quantity', pallet_row.quantity,
        'available_quantity', pallet_row.available_quantity, 'is_stored', pallet_row.is_stored,
        'current_location_id', pallet_row.current_location_id
      ),
      'original_balance', jsonb_build_object(
        'status', balance_row.status, 'quantity', balance_row.quantity,
        'available_quantity', balance_row.available_quantity, 'location_id', balance_row.location_id,
        'zone_id', balance_row.zone_id
      )
    )::text
  ) returning id into new_draft_id;

  update public.pallets
    set correction_state = 'pending', available_quantity = 0
    where id = pallet_row.id;
  update public.inventory_balances
    set correction_state = 'pending', available_quantity = 0
    where id = balance_row.id;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, from_location_id, actor_user_id, metadata)
  values ('inventory_correction_started', 'pallets', pallet_row.id, balance_row.warehouse_id, pallet_row.id, pallet_row.current_location_id, auth.uid(),
    jsonb_build_object('draft_id', new_draft_id, 'replacement_pallet_barcode', new_barcode, 'former_location_code', location_row.code));

  return query select new_draft_id, new_barcode, location_row.code;
end;
$$;

create or replace function public.cancel_inventory_pallet_correction(in_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.receipts%rowtype;
  meta jsonb;
  pallet_id uuid;
  balance_id uuid;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Inventory pallet corrections require Receiving permission.';
  end if;
  select * into draft_row from public.receipts where id = in_draft_id for update;
  if not found then raise exception 'Correction draft was not found.'; end if;
  meta := coalesce(draft_row.notes::jsonb, '{}'::jsonb);
  if meta->>'source_type' <> 'inventory_pallet_correction' or draft_row.status <> 'draft' then
    raise exception 'This correction can no longer be cancelled.';
  end if;
  pallet_id := (meta->>'correction_source_pallet_id')::uuid;
  balance_id := (meta->>'correction_source_balance_id')::uuid;

  update public.pallets set
    correction_state = null,
    status = (meta->'original_pallet'->>'status')::public.inventory_status,
    quantity = (meta->'original_pallet'->>'quantity')::numeric,
    available_quantity = (meta->'original_pallet'->>'available_quantity')::numeric,
    is_stored = coalesce((meta->'original_pallet'->>'is_stored')::boolean, true),
    current_location_id = (meta->'original_pallet'->>'current_location_id')::uuid
    where id = pallet_id;
  update public.inventory_balances set
    correction_state = null,
    status = (meta->'original_balance'->>'status')::public.inventory_status,
    quantity = (meta->'original_balance'->>'quantity')::numeric,
    available_quantity = (meta->'original_balance'->>'available_quantity')::numeric,
    location_id = (meta->'original_balance'->>'location_id')::uuid,
    zone_id = (meta->'original_balance'->>'zone_id')::uuid
    where id = balance_id;
  update public.receipts set status = 'cancelled' where id = in_draft_id;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, actor_user_id, metadata)
  select 'inventory_correction_cancelled', 'pallets', p.id, b.warehouse_id, p.id, auth.uid(), jsonb_build_object('draft_id', in_draft_id)
  from public.pallets p join public.inventory_balances b on b.pallet_id = p.id where p.id = pallet_id;
end;
$$;

create or replace function public.complete_inventory_pallet_correction(
  in_draft_id uuid,
  in_quantity numeric,
  in_expiry_date date,
  in_still_at_former_location boolean
)
returns table(inventory_balance_id uuid, pallet_id uuid, pallet_barcode text, putaway_task_id uuid, putaway_task_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.receipts%rowtype;
  meta jsonb;
  old_pallet public.pallets%rowtype;
  old_balance public.inventory_balances%rowtype;
  old_lot public.inventory_lots%rowtype;
  replacement_lot_id uuid;
  replacement_line_id uuid;
  replacement_pallet_id uuid;
  replacement_balance_id uuid;
  suggested_location_id uuid;
  new_task_id uuid;
  new_task_number text;
  former_location_id uuid;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Inventory pallet corrections require Receiving permission.';
  end if;
  if coalesce(in_quantity, 0) <= 0 then raise exception 'Quantity per pallet must be greater than zero.'; end if;
  select * into draft_row from public.receipts where id = in_draft_id for update;
  if not found then raise exception 'Correction draft was not found.'; end if;
  meta := coalesce(draft_row.notes::jsonb, '{}'::jsonb);
  if meta->>'source_type' <> 'inventory_pallet_correction' or draft_row.status <> 'draft' then
    raise exception 'This correction has already been completed or cancelled.';
  end if;
  select * into old_pallet from public.pallets where id = (meta->>'correction_source_pallet_id')::uuid for update;
  select * into old_balance from public.inventory_balances where id = (meta->>'correction_source_balance_id')::uuid for update;
  if old_pallet.correction_state <> 'pending' or old_balance.correction_state <> 'pending' then
    raise exception 'The original pallet is no longer reserved for this correction.';
  end if;
  former_location_id := (meta->>'former_location_id')::uuid;
  select * into old_lot from public.inventory_lots where id = old_pallet.inventory_lot_id;

  if old_lot.id is not null and old_lot.expiry_date is not distinct from in_expiry_date then
    replacement_lot_id := old_lot.id;
  else
    insert into public.inventory_lots (product_id, client_id, lot_number, batch_number, manufacture_date, loading_date, rotation_date, expiry_date)
    values (old_pallet.product_id, old_pallet.client_id, old_lot.lot_number, old_lot.batch_number, old_lot.manufacture_date, old_lot.loading_date, old_lot.rotation_date, in_expiry_date)
    returning id into replacement_lot_id;
  end if;

  insert into public.receipt_lines (receipt_id, product_id, packaging_profile_id, client_id, quantity, received_quantity, inventory_lot_id, notes)
  values (in_draft_id, old_pallet.product_id, old_pallet.packaging_profile_id, old_pallet.client_id, in_quantity, in_quantity, replacement_lot_id, 'Inventory pallet correction')
  returning id into replacement_line_id;

  insert into public.pallets (
    pallet_code, pallet_barcode, product_id, client_id, receipt_line_id, current_location_id, current_warehouse_id,
    inventory_lot_id, packaging_profile_id, quantity, available_quantity, status, is_stored,
    length, width, height, weight, reused_from_pallet_id
  ) values (
    meta->>'replacement_pallet_barcode', meta->>'replacement_pallet_barcode', old_pallet.product_id, old_pallet.client_id,
    replacement_line_id, case when in_still_at_former_location then former_location_id else null end, old_balance.warehouse_id,
    replacement_lot_id, old_pallet.packaging_profile_id, in_quantity, case when in_still_at_former_location then in_quantity else 0 end,
    case when in_still_at_former_location then 'available'::public.inventory_status else 'receiving'::public.inventory_status end,
    in_still_at_former_location, old_pallet.length, old_pallet.width, old_pallet.height, old_pallet.weight, old_pallet.id
  ) returning id into replacement_pallet_id;

  insert into public.inventory_balances (
    pallet_id, product_id, client_id, warehouse_id, zone_id, location_id, inventory_lot_id, status, quantity, available_quantity, expiry_date
  ) values (
    replacement_pallet_id, old_pallet.product_id, old_pallet.client_id, old_balance.warehouse_id,
    case when in_still_at_former_location then old_balance.zone_id else null end,
    case when in_still_at_former_location then former_location_id else null end,
    replacement_lot_id, case when in_still_at_former_location then 'available'::public.inventory_status else 'receiving'::public.inventory_status end,
    in_quantity, case when in_still_at_former_location then in_quantity else 0 end, in_expiry_date
  ) returning id into replacement_balance_id;

  update public.pallets set correction_state = 'superseded', quantity = 0, available_quantity = 0, current_location_id = null, is_stored = false where id = old_pallet.id;
  update public.inventory_balances set correction_state = 'superseded', quantity = 0, available_quantity = 0, location_id = null, zone_id = null where id = old_balance.id;
  update public.receipts set status = 'completed' where id = in_draft_id;
  insert into public.barcode_labels (label_type, entity_id, label_code, last_printed_at)
  values ('pallet', replacement_pallet_id, meta->>'replacement_pallet_barcode', now());

  if not in_still_at_former_location then
    select location_id into suggested_location_id from public.directed_putaway_candidates(replacement_pallet_id) limit 1;
    new_task_number := public.inventory_correction_code('PTA');
    insert into public.putaway_tasks (task_number, pallet_id, warehouse_id, suggested_location_id, status)
    values (new_task_number, replacement_pallet_id, old_balance.warehouse_id, suggested_location_id, 'queued')
    returning id into new_task_id;
  end if;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, from_location_id, to_location_id, actor_user_id, metadata)
  values ('inventory_pallet_corrected', 'pallets', replacement_pallet_id, old_balance.warehouse_id, replacement_pallet_id,
    former_location_id, case when in_still_at_former_location then former_location_id else null end, auth.uid(),
    jsonb_build_object('draft_id', in_draft_id, 'superseded_pallet_id', old_pallet.id, 'quantity', in_quantity,
      'expiry_date', in_expiry_date, 'still_at_former_location', in_still_at_former_location, 'putaway_task_id', new_task_id));

  return query select replacement_balance_id, replacement_pallet_id, meta->>'replacement_pallet_barcode', new_task_id, new_task_number;
end;
$$;

revoke all on function public.begin_inventory_pallet_correction(uuid) from public, anon;
revoke all on function public.cancel_inventory_pallet_correction(uuid) from public, anon;
revoke all on function public.complete_inventory_pallet_correction(uuid, numeric, date, boolean) from public, anon;
grant execute on function public.begin_inventory_pallet_correction(uuid) to authenticated;
grant execute on function public.cancel_inventory_pallet_correction(uuid) to authenticated;
grant execute on function public.complete_inventory_pallet_correction(uuid, numeric, date, boolean) to authenticated;

create or replace view public.inventory_search_view
with (security_invoker = true) as
select
  ib.id as inventory_balance_id, ib.warehouse_id, ib.product_id, ib.client_id, ib.location_id,
  p.id as pallet_id, p.pallet_code, p.pallet_barcode,
  r.container_number, r.po_number, pr.sku, pr.name as product_name, pr.barcode as product_barcode,
  c.code as client_code, c.name as client_name, il.lot_number, il.batch_number, il.expiry_date, il.manufacture_date,
  w.code as warehouse_code, w.name as warehouse_name, z.code as zone_code, z.name as zone_name, l.code as location_code,
  ib.status, ib.quantity, ib.available_quantity, ib.reserved_quantity, ib.held_quantity, ib.damaged_quantity, ib.received_at,
  p.length, p.width, p.height, p.weight, pr.temperature_requirement, pr.product_family, pr.rotation_method,
  p.correction_state as pallet_correction_state, ib.correction_state
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

grant select on public.inventory_search_view to authenticated;
grant select on public.inventory_search_view to service_role;
