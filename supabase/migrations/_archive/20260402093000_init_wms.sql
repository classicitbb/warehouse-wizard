create extension if not exists "pgcrypto";

create type public.app_role_code as enum ('admin', 'warehouse_manager', 'inventory_clerk', 'warehouse_operator');
create type public.temperature_class as enum ('ambient', 'cool', 'frozen');
create type public.location_type as enum ('rack', 'staging', 'quarantine', 'dispatch', 'receiving', 'floor', 'returns');
create type public.location_status as enum ('active', 'blocked', 'maintenance', 'disabled');
create type public.inventory_status as enum ('receiving', 'available', 'reserved', 'picked', 'staged', 'in_transit', 'hold', 'quarantine', 'damaged', 'missing');
create type public.rotation_method as enum ('fifo', 'fefo');
create type public.task_status as enum ('draft', 'queued', 'assigned', 'in_progress', 'completed', 'cancelled', 'exception');
create type public.movement_type as enum ('receipt', 'putaway', 'move', 'pick', 'transfer_dispatch', 'transfer_receive', 'cycle_count', 'adjustment', 'status_change', 'label_reprint');
create type public.receipt_type as enum ('po', 'transfer', 'manual');
create type public.order_type as enum ('sales', 'transfer');
create type public.transfer_type as enum ('inter_warehouse', 'intra_warehouse');
create type public.count_scope as enum ('location', 'zone', 'sku', 'spot');
create type public.label_type as enum ('pallet', 'location', 'pick_list', 'transfer_document', 'count_sheet');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code public.app_role_code not null unique,
  name text not null unique,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  full_name text,
  default_warehouse_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  warehouse_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, role_id, warehouse_id)
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address_line_1 text,
  address_line_2 text,
  city text,
  country text,
  has_cool_zone boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  add constraint profiles_default_warehouse_id_fkey
  foreign key (default_warehouse_id) references public.warehouses (id) on delete set null;

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  code text not null,
  name text not null,
  temperature_class public.temperature_class not null default 'ambient',
  is_dispatch boolean not null default false,
  is_quarantine boolean not null default false,
  is_staging boolean not null default false,
  sort_order integer not null default 0,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (warehouse_id, code)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  zone_id uuid not null references public.zones (id) on delete cascade,
  code text not null unique,
  aisle text,
  bay text,
  level integer,
  depth integer not null default 1 check (depth between 1 and 5),
  location_type public.location_type not null default 'rack',
  temperature_class public.temperature_class not null default 'ambient',
  max_length numeric(10,2),
  max_width numeric(10,2),
  max_height numeric(10,2),
  max_weight numeric(12,2),
  max_pallets integer not null default 1,
  mixed_sku_allowed boolean not null default false,
  mixed_lot_allowed boolean not null default false,
  allowed_product_family text,
  pick_sequence integer not null default 0,
  putaway_sequence integer not null default 0,
  status public.location_status not null default 'active',
  notes text,
  layout_x numeric(10,2),
  layout_y numeric(10,2),
  layout_width numeric(10,2),
  layout_height numeric(10,2),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  allow_mixed_stock boolean not null default false,
  allow_mixed_sku_pallet boolean not null default false,
  allow_mixed_lot_pallet boolean not null default false,
  require_expiry boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  barcode text unique,
  name text not null,
  description text,
  client_owner_id uuid not null references public.clients (id) on delete restrict,
  product_family text,
  temperature_requirement public.temperature_class not null default 'ambient',
  length numeric(10,2),
  width numeric(10,2),
  height numeric(10,2),
  weight numeric(12,2),
  stackable boolean not null default true,
  max_stack_height integer,
  lot_tracked boolean not null default true,
  batch_tracked boolean not null default false,
  expiry_tracked boolean not null default false,
  rotation_method public.rotation_method not null default 'fifo',
  active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.product_packaging_profiles (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  profile_name text not null,
  package_type text not null,
  units_per_package integer not null default 1,
  length numeric(10,2),
  width numeric(10,2),
  height numeric(10,2),
  weight numeric(12,2),
  barcode text,
  is_default boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (product_id, profile_name)
);

create table public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  lot_number text,
  batch_number text,
  manufacture_date date,
  expiry_date date,
  loading_date date,
  rotation_date date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique nulls not distinct (product_id, client_id, lot_number, batch_number, expiry_date)
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  receipt_type public.receipt_type not null,
  reference_number text,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  source_warehouse_id uuid references public.warehouses (id) on delete restrict,
  client_id uuid references public.clients (id) on delete restrict,
  status public.task_status not null default 'draft',
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  packaging_profile_id uuid references public.product_packaging_profiles (id) on delete set null,
  client_id uuid not null references public.clients (id) on delete restrict,
  quantity numeric(14,2) not null check (quantity > 0),
  received_quantity numeric(14,2) not null default 0,
  override_length numeric(10,2),
  override_width numeric(10,2),
  override_height numeric(10,2),
  override_weight numeric(12,2),
  inventory_lot_id uuid references public.inventory_lots (id) on delete set null,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.pallets (
  id uuid primary key default gen_random_uuid(),
  pallet_code text not null unique,
  pallet_barcode text not null unique,
  product_id uuid not null references public.products (id) on delete restrict,
  client_id uuid not null references public.clients (id) on delete restrict,
  receipt_line_id uuid references public.receipt_lines (id) on delete set null,
  current_location_id uuid references public.locations (id) on delete set null,
  current_warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  inventory_lot_id uuid references public.inventory_lots (id) on delete set null,
  packaging_profile_id uuid references public.product_packaging_profiles (id) on delete set null,
  quantity numeric(14,2) not null check (quantity >= 0),
  available_quantity numeric(14,2) not null default 0,
  reserved_quantity numeric(14,2) not null default 0,
  held_quantity numeric(14,2) not null default 0,
  damaged_quantity numeric(14,2) not null default 0,
  status public.inventory_status not null default 'receiving',
  is_stored boolean not null default false,
  last_counted_at timestamptz,
  length numeric(10,2),
  width numeric(10,2),
  height numeric(10,2),
  weight numeric(12,2),
  stack_height integer,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  pallet_id uuid not null unique references public.pallets (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  client_id uuid not null references public.clients (id) on delete restrict,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  zone_id uuid references public.zones (id) on delete set null,
  location_id uuid references public.locations (id) on delete set null,
  inventory_lot_id uuid references public.inventory_lots (id) on delete set null,
  status public.inventory_status not null,
  quantity numeric(14,2) not null default 0,
  available_quantity numeric(14,2) not null default 0,
  reserved_quantity numeric(14,2) not null default 0,
  held_quantity numeric(14,2) not null default 0,
  damaged_quantity numeric(14,2) not null default 0,
  received_at timestamptz not null default timezone('utc', now()),
  expiry_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.putaway_tasks (
  id uuid primary key default gen_random_uuid(),
  task_number text not null unique,
  pallet_id uuid not null references public.pallets (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  suggested_location_id uuid references public.locations (id) on delete set null,
  assigned_user_id uuid references public.profiles (id) on delete set null,
  status public.task_status not null default 'queued',
  override_reason text,
  alternative_requested boolean not null default false,
  completed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.move_tasks (
  id uuid primary key default gen_random_uuid(),
  task_number text not null unique,
  pallet_id uuid not null references public.pallets (id) on delete cascade,
  from_location_id uuid references public.locations (id) on delete set null,
  to_location_id uuid references public.locations (id) on delete set null,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  transfer_id uuid,
  assigned_user_id uuid references public.profiles (id) on delete set null,
  status public.task_status not null default 'queued',
  reason text,
  completed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  order_type public.order_type not null default 'sales',
  client_id uuid not null references public.clients (id) on delete restrict,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  status public.task_status not null default 'draft',
  priority integer not null default 0,
  requested_ship_date date,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric(14,2) not null check (quantity > 0),
  allocated_quantity numeric(14,2) not null default 0,
  picked_quantity numeric(14,2) not null default 0,
  inventory_lot_id uuid references public.inventory_lots (id) on delete set null,
  required_expiry_before date,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.pick_lists (
  id uuid primary key default gen_random_uuid(),
  pick_list_number text not null unique,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  client_id uuid references public.clients (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  transfer_id uuid,
  consolidated boolean not null default false,
  status public.task_status not null default 'draft',
  released_at timestamptz,
  assigned_user_id uuid references public.profiles (id) on delete set null,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.pick_tasks (
  id uuid primary key default gen_random_uuid(),
  task_number text not null unique,
  pick_list_id uuid not null references public.pick_lists (id) on delete cascade,
  order_line_id uuid references public.order_lines (id) on delete set null,
  pallet_id uuid references public.pallets (id) on delete set null,
  location_id uuid references public.locations (id) on delete set null,
  staging_location_id uuid references public.locations (id) on delete set null,
  assigned_user_id uuid references public.profiles (id) on delete set null,
  status public.task_status not null default 'queued',
  requested_quantity numeric(14,2) not null check (requested_quantity > 0),
  confirmed_quantity numeric(14,2) not null default 0,
  short_reason text,
  completed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_number text not null unique,
  transfer_type public.transfer_type not null,
  source_warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  destination_warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  status public.task_status not null default 'draft',
  dispatched_at timestamptz,
  received_at timestamptz,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers (id) on delete cascade,
  pallet_id uuid references public.pallets (id) on delete set null,
  product_id uuid not null references public.products (id) on delete restrict,
  client_id uuid not null references public.clients (id) on delete restrict,
  quantity numeric(14,2) not null check (quantity > 0),
  inventory_lot_id uuid references public.inventory_lots (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.move_tasks
  add constraint move_tasks_transfer_id_fkey
  foreign key (transfer_id) references public.transfers (id) on delete set null;

alter table public.pick_lists
  add constraint pick_lists_transfer_id_fkey
  foreign key (transfer_id) references public.transfers (id) on delete set null;

create table public.cycle_counts (
  id uuid primary key default gen_random_uuid(),
  count_number text not null unique,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  zone_id uuid references public.zones (id) on delete set null,
  location_id uuid references public.locations (id) on delete set null,
  scope public.count_scope not null,
  status public.task_status not null default 'draft',
  assigned_user_id uuid references public.profiles (id) on delete set null,
  variance_threshold_percent numeric(7,2) not null default 5,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.cycle_count_lines (
  id uuid primary key default gen_random_uuid(),
  cycle_count_id uuid not null references public.cycle_counts (id) on delete cascade,
  location_id uuid references public.locations (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  pallet_id uuid references public.pallets (id) on delete set null,
  expected_quantity numeric(14,2) not null default 0,
  counted_quantity numeric(14,2) not null default 0,
  variance_quantity numeric(14,2) not null default 0,
  variance_percent numeric(7,2) not null default 0,
  status public.task_status not null default 'draft',
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  adjustment_number text not null unique,
  pallet_id uuid references public.pallets (id) on delete set null,
  inventory_balance_id uuid references public.inventory_balances (id) on delete set null,
  adjustment_type text not null,
  quantity_delta numeric(14,2) not null,
  old_status public.inventory_status,
  new_status public.inventory_status,
  reason text not null,
  approved_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.barcode_labels (
  id uuid primary key default gen_random_uuid(),
  label_type public.label_type not null,
  entity_id uuid not null,
  label_code text not null,
  storage_path text,
  printed_by uuid references public.profiles (id) on delete set null,
  reprint_count integer not null default 0,
  last_printed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type public.movement_type not null,
  entity_table text not null,
  entity_id uuid not null,
  warehouse_id uuid references public.warehouses (id) on delete set null,
  pallet_id uuid references public.pallets (id) on delete set null,
  from_location_id uuid references public.locations (id) on delete set null,
  to_location_id uuid references public.locations (id) on delete set null,
  actor_user_id uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.current_role_codes()
returns public.app_role_code[]
language sql
stable
as $$
  select coalesce(array_agg(distinct r.code), '{}')
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid();
$$;

create or replace function public.has_any_role(roles public.app_role_code[])
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.code = any(roles)
  );
$$;

create or replace function public.is_operator_for_assignment(assigned_user uuid)
returns boolean
language sql
stable
as $$
  select auth.uid() = assigned_user
    or public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]);
$$;

create or replace function public.log_audit_event(
  in_event_type public.movement_type,
  in_entity_table text,
  in_entity_id uuid,
  in_warehouse_id uuid default null,
  in_pallet_id uuid default null,
  in_from_location_id uuid default null,
  in_to_location_id uuid default null,
  in_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.audit_events (
    event_type,
    entity_table,
    entity_id,
    warehouse_id,
    pallet_id,
    from_location_id,
    to_location_id,
    actor_user_id,
    metadata
  )
  values (
    in_event_type,
    in_entity_table,
    in_entity_id,
    in_warehouse_id,
    in_pallet_id,
    in_from_location_id,
    in_to_location_id,
    auth.uid(),
    in_metadata
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.directed_putaway_candidates(in_pallet_id uuid)
returns table (
  location_id uuid,
  location_code text,
  score numeric,
  reason text
)
language sql
stable
as $$
  with pallet_context as (
    select
      p.id,
      p.client_id,
      p.product_id,
      p.length,
      p.width,
      p.height,
      p.weight,
      p.current_warehouse_id as warehouse_id,
      pr.product_family,
      pr.temperature_requirement
    from public.pallets p
    join public.products pr on pr.id = p.product_id
    where p.id = in_pallet_id
  ),
  location_fill as (
    select
      ib.location_id,
      count(*) as pallet_count,
      bool_or(ib.product_id <> pc.product_id) as has_other_sku,
      bool_or(ib.client_id <> pc.client_id) as has_other_client
    from public.inventory_balances ib
    join pallet_context pc on true
    where ib.location_id is not null
      and ib.status not in ('picked', 'in_transit', 'missing')
    group by ib.location_id
  )
  select
    l.id,
    l.code,
    (
      case when l.temperature_class = pc.temperature_requirement then 50 else 0 end +
      case when coalesce(lf.pallet_count, 0) = 0 then 15 else 0 end +
      greatest(0, 10 - l.putaway_sequence / 10.0) +
      case when coalesce(lf.has_other_sku, false) then -40 else 5 end +
      case when coalesce(lf.has_other_client, false) then -25 else 5 end
    )::numeric as score,
    concat_ws(
      '; ',
      case when l.temperature_class = pc.temperature_requirement then 'temperature_match' else 'temperature_mismatch' end,
      case when coalesce(lf.pallet_count, 0) = 0 then 'empty_slot' else 'consolidation_slot' end,
      case when l.allowed_product_family is null or l.allowed_product_family = pc.product_family then 'family_ok' else 'family_restricted' end
    ) as reason
  from public.locations l
  join pallet_context pc on pc.warehouse_id = l.warehouse_id
  left join location_fill lf on lf.location_id = l.id
  where l.location_type = 'rack'
    and l.status = 'active'
    and l.temperature_class = pc.temperature_requirement
    and (l.allowed_product_family is null or l.allowed_product_family = pc.product_family)
    and (l.max_length is null or pc.length is null or l.max_length >= pc.length)
    and (l.max_width is null or pc.width is null or l.max_width >= pc.width)
    and (l.max_height is null or pc.height is null or l.max_height >= pc.height)
    and (l.max_weight is null or pc.weight is null or l.max_weight >= pc.weight)
    and (coalesce(lf.pallet_count, 0) < l.max_pallets)
    and (l.mixed_sku_allowed or not coalesce(lf.has_other_sku, false))
  order by score desc, l.putaway_sequence asc, l.code asc
  limit 20;
$$;

create or replace view public.inventory_search_view as
select
  ib.id as inventory_balance_id,
  ib.pallet_id,
  p.pallet_code,
  p.pallet_barcode,
  ib.product_id,
  pr.sku,
  pr.barcode as product_barcode,
  pr.name as product_name,
  ib.client_id,
  c.name as client_name,
  ib.warehouse_id,
  w.code as warehouse_code,
  z.code as zone_code,
  l.code as location_code,
  ib.inventory_lot_id,
  il.lot_number,
  il.batch_number,
  il.expiry_date,
  ib.status,
  ib.quantity,
  ib.available_quantity,
  ib.reserved_quantity,
  ib.held_quantity,
  ib.damaged_quantity,
  ib.received_at
from public.inventory_balances ib
join public.pallets p on p.id = ib.pallet_id
join public.products pr on pr.id = ib.product_id
join public.clients c on c.id = ib.client_id
join public.warehouses w on w.id = ib.warehouse_id
left join public.zones z on z.id = ib.zone_id
left join public.locations l on l.id = ib.location_id
left join public.inventory_lots il on il.id = ib.inventory_lot_id;

create or replace view public.location_occupancy_view as
select
  l.id as location_id,
  l.code as location_code,
  l.warehouse_id,
  l.zone_id,
  l.location_type,
  l.temperature_class,
  l.status,
  count(ib.id) filter (where ib.status not in ('picked', 'in_transit', 'missing')) as occupied_pallets,
  l.max_pallets,
  (count(ib.id) filter (where ib.status not in ('picked', 'in_transit', 'missing')) >= l.max_pallets) as is_full,
  bool_or(il.expiry_date <= current_date + interval '30 days') as has_expiring_stock
from public.locations l
left join public.inventory_balances ib on ib.location_id = l.id
left join public.inventory_lots il on il.id = ib.inventory_lot_id
group by l.id;

insert into storage.buckets (id, name, public)
values
  ('labels', 'labels', false),
  ('imports', 'imports', false),
  ('attachments', 'attachments', false)
on conflict (id) do nothing;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create trigger set_roles_updated_at before update on public.roles for each row execute function public.set_updated_at();
create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_user_roles_updated_at before update on public.user_roles for each row execute function public.set_updated_at();
create trigger set_warehouses_updated_at before update on public.warehouses for each row execute function public.set_updated_at();
create trigger set_zones_updated_at before update on public.zones for each row execute function public.set_updated_at();
create trigger set_locations_updated_at before update on public.locations for each row execute function public.set_updated_at();
create trigger set_clients_updated_at before update on public.clients for each row execute function public.set_updated_at();
create trigger set_products_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger set_product_packaging_profiles_updated_at before update on public.product_packaging_profiles for each row execute function public.set_updated_at();
create trigger set_inventory_lots_updated_at before update on public.inventory_lots for each row execute function public.set_updated_at();
create trigger set_receipts_updated_at before update on public.receipts for each row execute function public.set_updated_at();
create trigger set_receipt_lines_updated_at before update on public.receipt_lines for each row execute function public.set_updated_at();
create trigger set_pallets_updated_at before update on public.pallets for each row execute function public.set_updated_at();
create trigger set_inventory_balances_updated_at before update on public.inventory_balances for each row execute function public.set_updated_at();
create trigger set_putaway_tasks_updated_at before update on public.putaway_tasks for each row execute function public.set_updated_at();
create trigger set_move_tasks_updated_at before update on public.move_tasks for each row execute function public.set_updated_at();
create trigger set_orders_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger set_order_lines_updated_at before update on public.order_lines for each row execute function public.set_updated_at();
create trigger set_pick_lists_updated_at before update on public.pick_lists for each row execute function public.set_updated_at();
create trigger set_pick_tasks_updated_at before update on public.pick_tasks for each row execute function public.set_updated_at();
create trigger set_transfers_updated_at before update on public.transfers for each row execute function public.set_updated_at();
create trigger set_transfer_lines_updated_at before update on public.transfer_lines for each row execute function public.set_updated_at();
create trigger set_cycle_counts_updated_at before update on public.cycle_counts for each row execute function public.set_updated_at();
create trigger set_cycle_count_lines_updated_at before update on public.cycle_count_lines for each row execute function public.set_updated_at();
create trigger set_stock_adjustments_updated_at before update on public.stock_adjustments for each row execute function public.set_updated_at();
create trigger set_barcode_labels_updated_at before update on public.barcode_labels for each row execute function public.set_updated_at();

create index idx_profiles_default_warehouse on public.profiles (default_warehouse_id);
create index idx_user_roles_user on public.user_roles (user_id);
create index idx_user_roles_role on public.user_roles (role_id);
create index idx_zones_warehouse on public.zones (warehouse_id);
create index idx_locations_warehouse on public.locations (warehouse_id);
create index idx_locations_zone on public.locations (zone_id);
create index idx_locations_code on public.locations (code);
create index idx_locations_pick_sequence on public.locations (warehouse_id, pick_sequence);
create index idx_locations_putaway_sequence on public.locations (warehouse_id, putaway_sequence);
create index idx_clients_code on public.clients (code);
create index idx_products_sku on public.products (sku);
create index idx_products_barcode on public.products (barcode);
create index idx_products_owner on public.products (client_owner_id);
create index idx_product_packaging_profiles_product on public.product_packaging_profiles (product_id);
create index idx_inventory_lots_product on public.inventory_lots (product_id);
create index idx_inventory_lots_client on public.inventory_lots (client_id);
create index idx_inventory_lots_lot_batch on public.inventory_lots (lot_number, batch_number);
create index idx_inventory_lots_expiry on public.inventory_lots (expiry_date);
create index idx_receipts_warehouse on public.receipts (warehouse_id);
create index idx_receipt_lines_receipt on public.receipt_lines (receipt_id);
create index idx_pallets_product on public.pallets (product_id);
create index idx_pallets_barcode on public.pallets (pallet_barcode);
create index idx_pallets_location on public.pallets (current_location_id);
create index idx_pallets_status on public.pallets (status);
create index idx_inventory_balances_product on public.inventory_balances (product_id);
create index idx_inventory_balances_client on public.inventory_balances (client_id);
create index idx_inventory_balances_location on public.inventory_balances (location_id);
create index idx_inventory_balances_warehouse on public.inventory_balances (warehouse_id);
create index idx_inventory_balances_status on public.inventory_balances (status);
create index idx_inventory_balances_expiry on public.inventory_balances (expiry_date);
create index idx_putaway_tasks_assigned on public.putaway_tasks (assigned_user_id, status);
create index idx_move_tasks_assigned on public.move_tasks (assigned_user_id, status);
create index idx_pick_lists_warehouse on public.pick_lists (warehouse_id, status);
create index idx_pick_tasks_assigned on public.pick_tasks (assigned_user_id, status);
create index idx_orders_client on public.orders (client_id, warehouse_id);
create index idx_order_lines_order on public.order_lines (order_id);
create index idx_transfers_source_destination on public.transfers (source_warehouse_id, destination_warehouse_id);
create index idx_cycle_counts_assigned on public.cycle_counts (assigned_user_id, status);
create index idx_stock_adjustments_pallet on public.stock_adjustments (pallet_id);
create index idx_barcode_labels_entity on public.barcode_labels (entity_id, label_type);
create index idx_audit_events_entity on public.audit_events (entity_table, entity_id);
create index idx_audit_events_pallet on public.audit_events (pallet_id, created_at desc);
create index idx_audit_events_warehouse on public.audit_events (warehouse_id, created_at desc);

alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.warehouses enable row level security;
alter table public.zones enable row level security;
alter table public.locations enable row level security;
alter table public.clients enable row level security;
alter table public.products enable row level security;
alter table public.product_packaging_profiles enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_lines enable row level security;
alter table public.pallets enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.putaway_tasks enable row level security;
alter table public.move_tasks enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.pick_lists enable row level security;
alter table public.pick_tasks enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_lines enable row level security;
alter table public.cycle_counts enable row level security;
alter table public.cycle_count_lines enable row level security;
alter table public.stock_adjustments enable row level security;
alter table public.barcode_labels enable row level security;
alter table public.audit_events enable row level security;

create policy "profiles self read"
  on public.profiles for select
  using (auth.uid() = id or public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]));

create policy "profiles self update"
  on public.profiles for update
  using (auth.uid() = id or public.has_any_role(array['admin'::public.app_role_code]))
  with check (auth.uid() = id or public.has_any_role(array['admin'::public.app_role_code]));

create policy "roles read authenticated"
  on public.roles for select
  using (auth.role() = 'authenticated');

create policy "roles admin manage"
  on public.roles for all
  using (public.has_any_role(array['admin'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code]));

create policy "user_roles read authenticated"
  on public.user_roles for select
  using (auth.role() = 'authenticated');

create policy "user_roles admin manage"
  on public.user_roles for all
  using (public.has_any_role(array['admin'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code]));

create policy "master data read"
  on public.warehouses for select
  using (auth.role() = 'authenticated');

create policy "warehouses admin manager manage"
  on public.warehouses for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]));

create policy "zones read authenticated"
  on public.zones for select using (auth.role() = 'authenticated');
create policy "zones admin manager manage"
  on public.zones for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]));

create policy "locations read authenticated"
  on public.locations for select using (auth.role() = 'authenticated');
create policy "locations admin manager manage"
  on public.locations for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]));

create policy "clients read authenticated"
  on public.clients for select using (auth.role() = 'authenticated');
create policy "clients admin manager manage"
  on public.clients for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]));

create policy "products read authenticated"
  on public.products for select using (auth.role() = 'authenticated');
create policy "products admin manager clerk manage"
  on public.products for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]));

create policy "product packaging read authenticated"
  on public.product_packaging_profiles for select using (auth.role() = 'authenticated');
create policy "product packaging admin manager clerk manage"
  on public.product_packaging_profiles for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]));

create policy "inventory lots read authenticated"
  on public.inventory_lots for select using (auth.role() = 'authenticated');
create policy "inventory lots admin manager clerk manage"
  on public.inventory_lots for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]));

create policy "receipts read authenticated"
  on public.receipts for select using (auth.role() = 'authenticated');
create policy "receipts admin manager clerk manage"
  on public.receipts for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]));

create policy "receipt lines read authenticated"
  on public.receipt_lines for select using (auth.role() = 'authenticated');
create policy "receipt lines admin manager clerk manage"
  on public.receipt_lines for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]));

create policy "pallets read authenticated"
  on public.pallets for select using (auth.role() = 'authenticated');
create policy "pallets insert clerks"
  on public.pallets for insert
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]));
create policy "pallets update authenticated"
  on public.pallets for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "inventory balances read authenticated"
  on public.inventory_balances for select using (auth.role() = 'authenticated');
create policy "inventory balances admin manager clerk manage"
  on public.inventory_balances for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]));

create policy "putaway tasks read assigned"
  on public.putaway_tasks for select
  using (public.is_operator_for_assignment(assigned_user_id));
create policy "putaway tasks manage assigned"
  on public.putaway_tasks for all
  using (public.is_operator_for_assignment(assigned_user_id))
  with check (public.is_operator_for_assignment(assigned_user_id));

create policy "move tasks read assigned"
  on public.move_tasks for select
  using (public.is_operator_for_assignment(assigned_user_id));
create policy "move tasks manage assigned"
  on public.move_tasks for all
  using (public.is_operator_for_assignment(assigned_user_id))
  with check (public.is_operator_for_assignment(assigned_user_id));

create policy "orders read authenticated"
  on public.orders for select using (auth.role() = 'authenticated');
create policy "orders admin manager manage"
  on public.orders for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]));

create policy "order lines read authenticated"
  on public.order_lines for select using (auth.role() = 'authenticated');
create policy "order lines admin manager manage"
  on public.order_lines for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]));

create policy "pick lists read authenticated"
  on public.pick_lists for select using (auth.role() = 'authenticated');
create policy "pick lists admin manager manage"
  on public.pick_lists for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code]));

create policy "pick tasks read assigned"
  on public.pick_tasks for select
  using (public.is_operator_for_assignment(assigned_user_id));
create policy "pick tasks manage assigned"
  on public.pick_tasks for all
  using (public.is_operator_for_assignment(assigned_user_id))
  with check (public.is_operator_for_assignment(assigned_user_id));

create policy "transfers read authenticated"
  on public.transfers for select using (auth.role() = 'authenticated');
create policy "transfers admin manager clerk manage"
  on public.transfers for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]));

create policy "transfer lines read authenticated"
  on public.transfer_lines for select using (auth.role() = 'authenticated');
create policy "transfer lines admin manager clerk manage"
  on public.transfer_lines for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]));

create policy "cycle counts read authenticated"
  on public.cycle_counts for select using (auth.role() = 'authenticated');
create policy "cycle counts manage assigned"
  on public.cycle_counts for all
  using (public.is_operator_for_assignment(assigned_user_id))
  with check (public.is_operator_for_assignment(assigned_user_id));

create policy "cycle count lines read authenticated"
  on public.cycle_count_lines for select using (auth.role() = 'authenticated');
create policy "cycle count lines manage authenticated"
  on public.cycle_count_lines for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "stock adjustments read authenticated"
  on public.stock_adjustments for select using (auth.role() = 'authenticated');
create policy "stock adjustments admin manager clerk manage"
  on public.stock_adjustments for all
  using (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code]));

create policy "barcode labels read authenticated"
  on public.barcode_labels for select using (auth.role() = 'authenticated');
create policy "barcode labels manage authenticated"
  on public.barcode_labels for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "audit events read authenticated"
  on public.audit_events for select using (auth.role() = 'authenticated');
create policy "audit events insert authenticated"
  on public.audit_events for insert
  with check (auth.role() = 'authenticated');

create policy "labels storage access"
  on storage.objects for all
  using (
    bucket_id in ('labels', 'imports', 'attachments')
    and auth.role() = 'authenticated'
  )
  with check (
    bucket_id in ('labels', 'imports', 'attachments')
    and auth.role() = 'authenticated'
  );

insert into public.roles (code, name, description)
values
  ('admin', 'Admin', 'Full access across the entire warehouse management system'),
  ('warehouse_manager', 'Warehouse Manager', 'Full operational access across warehouses'),
  ('inventory_clerk', 'Inventory Clerk', 'Receiving, search, cycle counts, and routine movements'),
  ('warehouse_operator', 'Warehouse Operator', 'Assigned task execution and limited operational visibility')
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      updated_at = timezone('utc', now());
