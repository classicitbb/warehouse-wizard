-- =============================================================================
-- CONSOLIDATED WMS SCHEMA
-- Squashes all prior migrations into a single idempotent baseline.
-- Adds deployment_subscription and licence_events tables for licence tracking.
-- =============================================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
do $$ begin
  create type public.app_role_code as enum (
    'admin', 'warehouse_manager', 'inventory_clerk', 'warehouse_operator', 'dispatch_driver'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.temperature_class as enum ('ambient', 'cool', 'frozen');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.location_type as enum (
    'rack', 'staging', 'dispatch', 'quarantine', 'floor', 'dock', 'other', 'receiving', 'returns'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.location_status as enum ('active', 'blocked', 'maintenance', 'disabled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.inventory_status as enum (
    'receiving', 'available', 'reserved', 'picked', 'staged', 'in_transit',
    'hold', 'quarantine', 'damaged', 'missing', 'shipped'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.rotation_method as enum ('fifo', 'fefo', 'lifo');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.task_status as enum (
    'draft', 'queued', 'assigned', 'in_progress', 'completed', 'cancelled', 'exception'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.movement_type as enum (
    'receipt', 'putaway', 'move', 'pick', 'transfer_dispatch', 'transfer_receive',
    'cycle_count', 'adjustment', 'status_change', 'label_reprint',
    'user_sign_in', 'user_access_change', 'transfer_driver_signoff'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.receipt_type as enum ('po', 'transfer', 'return', 'manual', 'other');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.order_type as enum ('sales', 'transfer');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.transfer_type as enum ('inter_warehouse', 'intra_warehouse');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.count_scope as enum ('location', 'zone', 'sku', 'spot');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.label_type as enum (
    'pallet', 'location', 'carton', 'count_sheet', 'pick_list', 'transfer_document'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.integration_system as enum ('netsuite', 'generic_rest');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.integration_job_status as enum (
    'queued', 'running', 'succeeded', 'failed', 'dead_letter'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.print_job_status as enum ('queued', 'sent', 'printed', 'failed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.recommendation_status as enum ('open', 'accepted', 'dismissed', 'resolved');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.quality_disposition as enum (
    'pending', 'pass', 'fail', 'hold', 'release', 'scrap', 'return_to_vendor'
  );
exception when duplicate_object then null;
end $$;

-- ============================================================
-- UTILITY FUNCTIONS (defined before tables/triggers that use them)
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
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
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(excluded.full_name, public.profiles.full_name),
        updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ============================================================
-- CORE TABLES
-- ============================================================

create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  code        public.app_role_code not null unique,
  name        text not null unique,
  description text,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

create table if not exists public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  email                text unique,
  full_name            text,
  phone                text,
  default_warehouse_id uuid,
  active               boolean not null default true,
  approved             boolean not null default false,
  user_code            text,
  badge_code           text,
  created_at           timestamptz not null default timezone('utc', now()),
  updated_at           timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_roles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role_id      uuid not null references public.roles (id) on delete cascade,
  warehouse_id uuid,
  is_hidden    boolean not null default false,
  hidden_at    timestamptz,
  hidden_reason text,
  created_at   timestamptz not null default timezone('utc', now()),
  updated_at   timestamptz not null default timezone('utc', now()),
  unique (user_id, role_id, warehouse_id)
);

create table if not exists public.warehouses (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  address_line_1 text,
  address_line_2 text,
  city          text,
  country       text not null default 'Barbados',
  has_cool_zone boolean not null default false,
  active        boolean not null default true,
  is_hidden     boolean not null default false,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  add constraint if not exists profiles_default_warehouse_id_fkey
  foreign key (default_warehouse_id) references public.warehouses (id) on delete set null;

create table if not exists public.zones (
  id            uuid primary key default gen_random_uuid(),
  warehouse_id  uuid not null references public.warehouses (id) on delete cascade,
  code          text not null,
  name          text not null,
  temperature_class public.temperature_class not null default 'ambient',
  is_dispatch   boolean not null default false,
  is_quarantine boolean not null default false,
  is_staging    boolean not null default false,
  sort_order    integer not null default 0,
  notes         text,
  is_hidden     boolean not null default false,
  hidden_at     timestamptz,
  hidden_reason text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now()),
  unique (warehouse_id, code)
);

create table if not exists public.locations (
  id                   uuid primary key default gen_random_uuid(),
  warehouse_id         uuid not null references public.warehouses (id) on delete cascade,
  zone_id              uuid not null references public.zones (id) on delete cascade,
  code                 text not null unique,
  aisle                text,
  bay                  text,
  level                integer default 1,
  depth                integer not null default 1,
  location_type        public.location_type not null default 'rack',
  temperature_class    public.temperature_class not null default 'ambient',
  max_length           numeric(10,2) default 120,
  max_width            numeric(10,2) default 100,
  max_height           numeric(10,2) default 190,
  max_weight           numeric(12,2) default 1250,
  max_pallets          integer not null default 1,
  mixed_sku_allowed    boolean not null default false,
  mixed_lot_allowed    boolean not null default false,
  allowed_product_family text,
  pick_sequence        integer not null default 0,
  putaway_sequence     integer not null default 0,
  status               text not null default 'active',
  notes                text,
  layout_x             numeric(10,2) default 0,
  layout_y             numeric(10,2) default 0,
  layout_width         numeric(10,2) default 10,
  layout_height        numeric(10,2) default 12,
  is_hidden            boolean not null default false,
  hidden_at            timestamptz,
  hidden_reason        text,
  max_pallet_height_cm integer check (max_pallet_height_cm > 0),
  location_notes       text,
  created_by           uuid references auth.users (id),
  created_at           timestamptz not null default timezone('utc', now()),
  updated_at           timestamptz not null default timezone('utc', now())
);

create table if not exists public.clients (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  name                  text not null,
  allow_mixed_stock     boolean not null default false,
  allow_mixed_sku_pallet boolean not null default false,
  allow_mixed_lot_pallet boolean not null default false,
  require_expiry        boolean not null default false,
  active                boolean not null default true,
  is_hidden             boolean not null default false,
  created_by            uuid references auth.users (id),
  created_at            timestamptz not null default timezone('utc', now()),
  updated_at            timestamptz not null default timezone('utc', now())
);

create table if not exists public.products (
  id                   uuid primary key default gen_random_uuid(),
  sku                  text not null unique,
  barcode              text unique,
  name                 text not null,
  description          text,
  client_owner_id      uuid references public.clients (id) on delete restrict,
  product_family       text,
  temperature_requirement public.temperature_class not null default 'ambient',
  length               numeric(10,2),
  width                numeric(10,2),
  height               numeric(10,2),
  weight               numeric(12,2),
  stackable            boolean not null default true,
  max_stack_height     integer default 5,
  lot_tracked          boolean not null default true,
  batch_tracked        boolean not null default false,
  expiry_tracked       boolean not null default false,
  rotation_method      public.rotation_method not null default 'fifo',
  active               boolean not null default true,
  is_hidden            boolean not null default false,
  created_by           uuid references auth.users (id),
  created_at           timestamptz not null default timezone('utc', now()),
  updated_at           timestamptz not null default timezone('utc', now())
);

create table if not exists public.product_packaging_profiles (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products (id) on delete cascade,
  profile_name    text not null,
  package_type    text,
  units_per_package integer not null default 1,
  length          numeric(10,2),
  width           numeric(10,2),
  height          numeric(10,2),
  weight          numeric(12,2),
  barcode         text,
  is_default      boolean not null default false,
  is_hidden       boolean not null default false,
  hidden_at       timestamptz,
  hidden_reason   text,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default timezone('utc', now()),
  updated_at      timestamptz not null default timezone('utc', now()),
  unique (product_id, profile_name)
);

create table if not exists public.inventory_lots (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products (id) on delete cascade,
  client_id        uuid references public.clients (id) on delete restrict,
  lot_number       text,
  batch_number     text,
  manufacture_date date,
  expiry_date      date,
  loading_date     date,
  rotation_date    date,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);

create table if not exists public.receipts (
  id                  uuid primary key default gen_random_uuid(),
  receipt_number      text not null unique,
  receipt_type        public.receipt_type not null default 'po',
  reference_number    text,
  warehouse_id        uuid not null references public.warehouses (id) on delete restrict,
  source_warehouse_id uuid references public.warehouses (id) on delete restrict,
  client_id           uuid references public.clients (id) on delete restrict,
  status              public.task_status not null default 'draft',
  notes               text,
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now())
);

create table if not exists public.receipt_lines (
  id                   uuid primary key default gen_random_uuid(),
  receipt_id           uuid not null references public.receipts (id) on delete cascade,
  product_id           uuid not null references public.products (id) on delete restrict,
  packaging_profile_id uuid references public.product_packaging_profiles (id) on delete set null,
  client_id            uuid references public.clients (id) on delete restrict,
  quantity             numeric(14,2) not null default 0,
  received_quantity    numeric(14,2) not null default 0,
  inventory_lot_id     uuid references public.inventory_lots (id) on delete set null,
  override_length      numeric(10,2),
  override_width       numeric(10,2),
  override_height      numeric(10,2),
  override_weight      numeric(12,2),
  notes                text,
  created_by           uuid references auth.users (id),
  created_at           timestamptz not null default timezone('utc', now()),
  updated_at           timestamptz not null default timezone('utc', now())
);

create table if not exists public.pallets (
  id                    uuid primary key default gen_random_uuid(),
  pallet_code           text not null unique,
  pallet_barcode        text not null unique,
  product_id            uuid not null references public.products (id) on delete restrict,
  client_id             uuid references public.clients (id) on delete restrict,
  receipt_line_id       uuid references public.receipt_lines (id) on delete set null,
  current_location_id   uuid references public.locations (id) on delete set null,
  current_warehouse_id  uuid references public.warehouses (id) on delete restrict,
  inventory_lot_id      uuid references public.inventory_lots (id) on delete set null,
  packaging_profile_id  uuid references public.product_packaging_profiles (id) on delete set null,
  quantity              numeric(14,2) not null default 0,
  available_quantity    numeric(14,2) not null default 0,
  reserved_quantity     numeric(14,2) not null default 0,
  held_quantity         numeric(14,2) not null default 0,
  damaged_quantity      numeric(14,2) not null default 0,
  status                public.inventory_status not null default 'receiving',
  is_stored             boolean not null default false,
  last_counted_at       timestamptz,
  length                numeric(10,2),
  width                 numeric(10,2),
  height                numeric(10,2),
  weight                numeric(12,2),
  stack_height          integer default 1,
  reused_from_pallet_id uuid references public.pallets (id),
  created_by            uuid references auth.users (id),
  created_at            timestamptz not null default timezone('utc', now()),
  updated_at            timestamptz not null default timezone('utc', now())
);

create table if not exists public.inventory_balances (
  id                uuid primary key default gen_random_uuid(),
  pallet_id         uuid not null unique references public.pallets (id) on delete cascade,
  product_id        uuid not null references public.products (id) on delete restrict,
  client_id         uuid references public.clients (id) on delete restrict,
  warehouse_id      uuid not null references public.warehouses (id) on delete restrict,
  zone_id           uuid references public.zones (id) on delete set null,
  location_id       uuid references public.locations (id) on delete set null,
  inventory_lot_id  uuid references public.inventory_lots (id) on delete set null,
  status            public.inventory_status not null default 'receiving',
  quantity          numeric(14,2) not null default 0,
  available_quantity numeric(14,2) not null default 0,
  reserved_quantity  numeric(14,2) not null default 0,
  held_quantity      numeric(14,2) not null default 0,
  damaged_quantity   numeric(14,2) not null default 0,
  received_at       timestamptz not null default timezone('utc', now()),
  expiry_date       date,
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now())
);

create table if not exists public.putaway_tasks (
  id                   uuid primary key default gen_random_uuid(),
  task_number          text not null unique,
  pallet_id            uuid not null references public.pallets (id) on delete cascade,
  warehouse_id         uuid not null references public.warehouses (id) on delete restrict,
  suggested_location_id uuid references public.locations (id) on delete set null,
  confirmed_location_id uuid references public.locations (id) on delete set null,
  assigned_user_id     uuid references auth.users (id) on delete set null,
  status               public.task_status not null default 'queued',
  override_reason      text,
  alternative_requested boolean not null default false,
  completed_at         timestamptz,
  created_by           uuid references auth.users (id),
  created_at           timestamptz not null default timezone('utc', now()),
  updated_at           timestamptz not null default timezone('utc', now())
);

create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),
  order_number        text not null unique,
  order_type          text not null default 'sales',
  client_id           uuid references public.clients (id) on delete restrict,
  warehouse_id        uuid not null references public.warehouses (id) on delete restrict,
  status              public.task_status not null default 'draft',
  priority            integer not null default 1,
  requested_ship_date date,
  notes               text,
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now())
);

create table if not exists public.order_lines (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders (id) on delete cascade,
  product_id         uuid not null references public.products (id) on delete restrict,
  quantity           numeric(14,2) not null default 0,
  allocated_quantity numeric(14,2) not null default 0,
  picked_quantity    numeric(14,2) not null default 0,
  inventory_lot_id   uuid references public.inventory_lots (id) on delete set null,
  notes              text,
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default timezone('utc', now()),
  updated_at         timestamptz not null default timezone('utc', now())
);

create table if not exists public.transfers (
  id                       uuid primary key default gen_random_uuid(),
  transfer_number          text not null unique,
  transfer_type            text not null default 'inter_warehouse',
  source_warehouse_id      uuid not null references public.warehouses (id) on delete restrict,
  destination_warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  status                   public.task_status not null default 'draft',
  dispatched_at            timestamptz,
  received_at              timestamptz,
  notes                    text,
  dispatch_signed_off_by   uuid references public.profiles (id) on delete set null,
  dispatch_signed_off_at   timestamptz,
  dispatch_signoff_code    text,
  created_by               uuid references auth.users (id),
  created_at               timestamptz not null default timezone('utc', now()),
  updated_at               timestamptz not null default timezone('utc', now())
);

create table if not exists public.move_tasks (
  id               uuid primary key default gen_random_uuid(),
  task_number      text not null unique,
  pallet_id        uuid not null references public.pallets (id) on delete cascade,
  from_location_id uuid references public.locations (id) on delete set null,
  to_location_id   uuid references public.locations (id) on delete set null,
  warehouse_id     uuid not null references public.warehouses (id) on delete restrict,
  transfer_id      uuid references public.transfers (id) on delete set null,
  assigned_user_id uuid references auth.users (id) on delete set null,
  status           public.task_status not null default 'queued',
  reason           text,
  completed_at     timestamptz,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);

create table if not exists public.pick_lists (
  id               uuid primary key default gen_random_uuid(),
  pick_list_number text not null unique,
  warehouse_id     uuid not null references public.warehouses (id) on delete restrict,
  client_id        uuid references public.clients (id) on delete set null,
  order_id         uuid references public.orders (id) on delete set null,
  transfer_id      uuid references public.transfers (id) on delete set null,
  consolidated     boolean not null default false,
  status           public.task_status not null default 'draft',
  released_at      timestamptz,
  assigned_user_id uuid references public.profiles (id) on delete set null,
  notes            text,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);

create table if not exists public.pick_tasks (
  id                  uuid primary key default gen_random_uuid(),
  task_number         text not null unique,
  pick_list_id        uuid not null references public.pick_lists (id) on delete cascade,
  order_line_id       uuid references public.order_lines (id) on delete set null,
  pallet_id           uuid references public.pallets (id) on delete set null,
  location_id         uuid references public.locations (id) on delete set null,
  staging_location_id uuid references public.locations (id) on delete set null,
  assigned_user_id    uuid references auth.users (id) on delete set null,
  requested_quantity  numeric(14,2) not null default 0,
  confirmed_quantity  numeric(14,2) not null default 0,
  status              public.task_status not null default 'queued',
  short_reason        text,
  completed_at        timestamptz,
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now())
);

create table if not exists public.transfer_lines (
  id               uuid primary key default gen_random_uuid(),
  transfer_id      uuid not null references public.transfers (id) on delete cascade,
  pallet_id        uuid references public.pallets (id) on delete set null,
  product_id       uuid not null references public.products (id) on delete restrict,
  client_id        uuid references public.clients (id) on delete restrict,
  quantity         numeric(14,2) not null default 0,
  inventory_lot_id uuid references public.inventory_lots (id) on delete set null,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);

create table if not exists public.cycle_counts (
  id                        uuid primary key default gen_random_uuid(),
  count_number              text not null unique,
  warehouse_id              uuid not null references public.warehouses (id) on delete restrict,
  zone_id                   uuid references public.zones (id) on delete set null,
  location_id               uuid references public.locations (id) on delete set null,
  scope                     public.count_scope not null default 'spot',
  status                    public.task_status not null default 'queued',
  assigned_user_id          uuid references auth.users (id) on delete set null,
  variance_threshold_percent numeric(5,2) not null default 5,
  notes                     text,
  created_by                uuid references auth.users (id),
  created_at                timestamptz not null default timezone('utc', now()),
  updated_at                timestamptz not null default timezone('utc', now())
);

create table if not exists public.cycle_count_lines (
  id               uuid primary key default gen_random_uuid(),
  cycle_count_id   uuid not null references public.cycle_counts (id) on delete cascade,
  location_id      uuid references public.locations (id) on delete set null,
  product_id       uuid references public.products (id) on delete set null,
  pallet_id        uuid references public.pallets (id) on delete set null,
  expected_quantity numeric(14,2) not null default 0,
  counted_quantity  numeric(14,2) default 0,
  variance_quantity numeric(14,2) default 0,
  variance_percent  numeric(8,2) default 0,
  status            public.task_status not null default 'queued',
  notes             text,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now())
);

create table if not exists public.stock_adjustments (
  id                    uuid primary key default gen_random_uuid(),
  adjustment_number     text not null,
  pallet_id             uuid references public.pallets (id) on delete set null,
  inventory_balance_id  uuid references public.inventory_balances (id) on delete set null,
  adjustment_type       text not null default 'status_change',
  quantity_delta        numeric(14,2) not null default 0,
  old_status            public.inventory_status,
  new_status            public.inventory_status,
  reason                text,
  created_by            uuid references auth.users (id),
  created_at            timestamptz not null default timezone('utc', now()),
  updated_at            timestamptz not null default timezone('utc', now())
);

create table if not exists public.barcode_labels (
  id             uuid primary key default gen_random_uuid(),
  label_type     text not null,
  entity_id      uuid not null,
  label_code     text not null,
  storage_path   text,
  printed_by     uuid references auth.users (id) on delete set null,
  reprint_count  integer not null default 0,
  last_printed_at timestamptz,
  created_at     timestamptz not null default timezone('utc', now()),
  updated_at     timestamptz not null default timezone('utc', now())
);

create table if not exists public.audit_events (
  id               uuid primary key default gen_random_uuid(),
  event_type       text not null,
  entity_table     text not null,
  entity_id        uuid not null,
  warehouse_id     uuid references public.warehouses (id) on delete set null,
  pallet_id        uuid references public.pallets (id) on delete set null,
  from_location_id uuid references public.locations (id) on delete set null,
  to_location_id   uuid references public.locations (id) on delete set null,
  actor_user_id    uuid references auth.users (id) on delete set null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default timezone('utc', now())
);

-- ============================================================
-- ENTERPRISE EXTENSION TABLES
-- ============================================================

create table if not exists public.integration_connections (
  id          uuid primary key default gen_random_uuid(),
  system      public.integration_system not null,
  name        text not null,
  base_url    text,
  enabled     boolean not null default false,
  config      jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.external_record_links (
  id                   uuid primary key default gen_random_uuid(),
  system               public.integration_system not null,
  local_table          text not null,
  local_id             uuid not null,
  external_record_type text not null,
  external_id          text not null,
  external_url         text,
  last_synced_at       timestamptz,
  unique (system, local_table, local_id, external_record_type)
);

create table if not exists public.integration_sync_jobs (
  id               uuid primary key default gen_random_uuid(),
  connection_id    uuid references public.integration_connections (id) on delete cascade,
  job_type         text not null,
  status           public.integration_job_status not null default 'queued',
  idempotency_key  text not null,
  payload          jsonb not null default '{}'::jsonb,
  result           jsonb,
  error_message    text,
  attempts         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (connection_id, idempotency_key)
);

create table if not exists public.integration_payload_logs (
  id           uuid primary key default gen_random_uuid(),
  sync_job_id  uuid references public.integration_sync_jobs (id) on delete cascade,
  direction    text not null check (direction in ('inbound', 'outbound')),
  payload      jsonb not null,
  response     jsonb,
  http_status  integer,
  created_at   timestamptz not null default now()
);

create table if not exists public.integration_dead_letters (
  id            uuid primary key default gen_random_uuid(),
  sync_job_id   uuid references public.integration_sync_jobs (id) on delete set null,
  reason        text not null,
  payload       jsonb not null default '{}'::jsonb,
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users (id),
  created_at    timestamptz not null default now()
);

create table if not exists public.report_definitions (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  audience      public.app_role_code[] not null default array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code],
  filters       jsonb not null default '{}'::jsonb,
  columns       jsonb not null default '[]'::jsonb,
  schedule_cron text,
  active        boolean not null default true,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.report_exports (
  id                    uuid primary key default gen_random_uuid(),
  report_definition_id  uuid references public.report_definitions (id) on delete cascade,
  requested_by          uuid references auth.users (id),
  status                text not null default 'queued',
  file_path             text,
  row_count             integer,
  error_message         text,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz
);

create table if not exists public.printer_stations (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  warehouse_id     uuid references public.warehouses (id),
  printer_language text not null default 'zpl',
  network_address  text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.label_templates (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  label_type       public.label_type not null,
  printer_language text not null default 'zpl',
  template_body    text not null,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.print_jobs (
  id                  uuid primary key default gen_random_uuid(),
  printer_station_id  uuid references public.printer_stations (id),
  label_template_id   uuid references public.label_templates (id),
  barcode_label_id    uuid references public.barcode_labels (id),
  status              public.print_job_status not null default 'queued',
  zpl_payload         text not null,
  error_message       text,
  requested_by        uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  printed_at          timestamptz
);

create table if not exists public.ai_recommendations (
  id                 uuid primary key default gen_random_uuid(),
  recommendation_key text not null,
  title              text not null,
  severity           text not null check (severity in ('critical', 'warning', 'info', 'success')),
  audience           public.app_role_code[] not null,
  reason             text not null,
  next_action        text not null,
  status             public.recommendation_status not null default 'open',
  context            jsonb not null default '{}'::jsonb,
  acted_by           uuid references auth.users (id),
  acted_at           timestamptz,
  created_at         timestamptz not null default now()
);

create table if not exists public.quality_inspections (
  id                  uuid primary key default gen_random_uuid(),
  inspection_number   text not null unique,
  pallet_id           uuid references public.pallets (id),
  receipt_id          uuid references public.receipts (id),
  disposition         public.quality_disposition not null default 'pending',
  pass_fail_criteria  jsonb not null default '{}'::jsonb,
  root_cause_code     text,
  corrective_action   text,
  inspected_by        uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create table if not exists public.return_authorizations (
  id           uuid primary key default gen_random_uuid(),
  rma_number   text not null unique,
  client_id    uuid references public.clients (id),
  warehouse_id uuid references public.warehouses (id),
  status       public.task_status not null default 'queued',
  disposition  public.quality_disposition not null default 'pending',
  reason       text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.dock_appointments (
  id                  uuid primary key default gen_random_uuid(),
  appointment_number  text not null unique,
  warehouse_id        uuid references public.warehouses (id),
  dock_door           text not null,
  carrier             text,
  driver_name         text,
  scheduled_at        timestamptz not null,
  status              public.task_status not null default 'queued',
  created_at          timestamptz not null default now()
);

create table if not exists public.staging_loads (
  id                   uuid primary key default gen_random_uuid(),
  pick_list_id         uuid references public.pick_lists (id),
  dock_appointment_id  uuid references public.dock_appointments (id),
  route_code           text not null,
  load_sequence        integer not null default 10,
  status               text not null default 'ready'
                         check (status in ('ready', 'called', 'loading', 'blocked', 'loaded')),
  blocker              text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.replenishment_tasks (
  id               uuid primary key default gen_random_uuid(),
  task_number      text not null unique,
  product_id       uuid references public.products (id),
  warehouse_id     uuid references public.warehouses (id),
  from_location_id uuid references public.locations (id),
  to_location_id   uuid references public.locations (id),
  reorder_point    numeric not null default 0,
  target_quantity  numeric not null default 0,
  status           public.task_status not null default 'queued',
  assigned_user_id uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create table if not exists public.work_templates (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  workflow    text not null,
  priority    integer not null default 50,
  query_rules jsonb not null default '{}'::jsonb,
  step_rules  jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.client_variables (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  key           text not null,
  value         text not null default '',
  variable_type text not null default 'text'
                  check (variable_type in ('text', 'number', 'boolean', 'date', 'json')),
  description   text,
  is_hidden     boolean not null default false,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (client_id, key)
);

create table if not exists public.system_logs (
  id           uuid primary key default gen_random_uuid(),
  log_type     text not null default 'system_change'
                 check (log_type in ('error', 'bug', 'system_change', 'infrastructure', 'record_count', 'info')),
  severity     text not null default 'info'
                 check (severity in ('debug', 'info', 'warning', 'error', 'critical')),
  title        text not null,
  message      text,
  details      jsonb,
  source       text,
  table_name   text,
  record_count bigint,
  resolved     boolean not null default false,
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users (id),
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now()
);

-- ============================================================
-- SUBSCRIPTION & LICENCE TABLES (new)
-- ============================================================

create table if not exists public.deployment_subscription (
  id                  uuid primary key default gen_random_uuid(),
  plan_code           text not null default 'trial',
  plan_name           text not null default 'Trial',
  licence_key         text unique,
  subscribed_at       timestamptz not null default now(),
  expires_at          timestamptz,
  licence_valid_until timestamptz,
  max_warehouses      integer not null default 1,
  max_users           integer not null default 5,
  features            jsonb not null default '[]'::jsonb,
  is_active           boolean not null default true,
  notes               text,
  created_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.licence_events (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.deployment_subscription (id) on delete set null,
  event_type      text not null
                    check (event_type in ('activated', 'renewed', 'expired', 'checked', 'revoked', 'updated')),
  licence_key     text,
  valid_until     timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_profiles_default_warehouse on public.profiles (default_warehouse_id);
create index if not exists idx_user_roles_user on public.user_roles (user_id);
create index if not exists idx_user_roles_role on public.user_roles (role_id);
create index if not exists idx_zones_warehouse on public.zones (warehouse_id);
create index if not exists idx_locations_warehouse on public.locations (warehouse_id);
create index if not exists idx_locations_zone on public.locations (zone_id);
create index if not exists idx_locations_code on public.locations (code);
create index if not exists idx_locations_pick_sequence on public.locations (warehouse_id, pick_sequence);
create index if not exists idx_locations_putaway_sequence on public.locations (warehouse_id, putaway_sequence);
create index if not exists idx_clients_code on public.clients (code);
create index if not exists idx_products_sku on public.products (sku);
create index if not exists idx_products_barcode on public.products (barcode);
create index if not exists idx_products_owner on public.products (client_owner_id);
create index if not exists idx_product_packaging_profiles_product on public.product_packaging_profiles (product_id);
create index if not exists idx_inventory_lots_product on public.inventory_lots (product_id);
create index if not exists idx_inventory_lots_client on public.inventory_lots (client_id);
create index if not exists idx_inventory_lots_lot_batch on public.inventory_lots (lot_number, batch_number);
create index if not exists idx_inventory_lots_expiry on public.inventory_lots (expiry_date);
create index if not exists idx_receipts_warehouse on public.receipts (warehouse_id);
create index if not exists idx_receipt_lines_receipt on public.receipt_lines (receipt_id);
create index if not exists idx_pallets_product on public.pallets (product_id);
create index if not exists idx_pallets_barcode on public.pallets (pallet_barcode);
create index if not exists idx_pallets_location on public.pallets (current_location_id);
create index if not exists idx_pallets_status on public.pallets (status);
create index if not exists idx_inventory_balances_product on public.inventory_balances (product_id);
create index if not exists idx_inventory_balances_client on public.inventory_balances (client_id);
create index if not exists idx_inventory_balances_location on public.inventory_balances (location_id);
create index if not exists idx_inventory_balances_warehouse on public.inventory_balances (warehouse_id);
create index if not exists idx_inventory_balances_status on public.inventory_balances (status);
create index if not exists idx_inventory_balances_expiry on public.inventory_balances (expiry_date);
create index if not exists idx_putaway_tasks_assigned on public.putaway_tasks (assigned_user_id, status);
create index if not exists idx_move_tasks_assigned on public.move_tasks (assigned_user_id, status);
create index if not exists idx_pick_lists_warehouse on public.pick_lists (warehouse_id, status);
create index if not exists idx_pick_tasks_assigned on public.pick_tasks (assigned_user_id, status);
create index if not exists idx_orders_client on public.orders (client_id, warehouse_id);
create index if not exists idx_order_lines_order on public.order_lines (order_id);
create index if not exists idx_transfers_source_destination on public.transfers (source_warehouse_id, destination_warehouse_id);
create index if not exists idx_cycle_counts_assigned on public.cycle_counts (assigned_user_id, status);
create index if not exists idx_stock_adjustments_pallet on public.stock_adjustments (pallet_id);
create index if not exists idx_barcode_labels_entity on public.barcode_labels (entity_id, label_type);
create index if not exists idx_audit_events_entity on public.audit_events (entity_table, entity_id);
create index if not exists idx_audit_events_pallet on public.audit_events (pallet_id, created_at desc);
create index if not exists idx_audit_events_warehouse on public.audit_events (warehouse_id, created_at desc);
create unique index if not exists idx_profiles_user_code_unique
  on public.profiles (upper(user_code))
  where user_code is not null and user_code <> '';
create unique index if not exists idx_profiles_badge_code_unique
  on public.profiles (upper(badge_code))
  where badge_code is not null and badge_code <> '';
create index if not exists idx_external_record_links_lookup on public.external_record_links (system, external_record_type, external_id);
create index if not exists idx_external_record_links_local on public.external_record_links (local_table, local_id);
create index if not exists idx_integration_sync_jobs_status on public.integration_sync_jobs (status, created_at);
create index if not exists idx_integration_payload_logs_job on public.integration_payload_logs (sync_job_id);
create index if not exists idx_integration_dead_letters_unresolved on public.integration_dead_letters (resolved_at) where resolved_at is null;
create index if not exists idx_report_exports_status on public.report_exports (status, created_at);
create index if not exists idx_print_jobs_status on public.print_jobs (status, created_at);
create index if not exists idx_print_jobs_station on public.print_jobs (printer_station_id);
create index if not exists idx_ai_recommendations_status on public.ai_recommendations (status, severity);
create index if not exists idx_staging_loads_status on public.staging_loads (status, route_code);
create index if not exists system_logs_log_type_idx on public.system_logs (log_type);
create index if not exists system_logs_created_at_idx on public.system_logs (created_at desc);
create index if not exists system_logs_severity_idx on public.system_logs (severity);
create index if not exists idx_deployment_subscription_active on public.deployment_subscription (is_active) where is_active = true;
create index if not exists idx_licence_events_subscription on public.licence_events (subscription_id, created_at desc);

-- ============================================================
-- TRIGGERS
-- ============================================================
create or replace trigger set_roles_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

create or replace trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace trigger set_user_roles_updated_at
  before update on public.user_roles
  for each row execute function public.set_updated_at();

create or replace trigger set_warehouses_updated_at
  before update on public.warehouses
  for each row execute function public.set_updated_at();

create or replace trigger set_zones_updated_at
  before update on public.zones
  for each row execute function public.set_updated_at();

create or replace trigger set_locations_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

create or replace trigger set_clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

create or replace trigger set_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create or replace trigger set_product_packaging_profiles_updated_at
  before update on public.product_packaging_profiles
  for each row execute function public.set_updated_at();

create or replace trigger set_inventory_lots_updated_at
  before update on public.inventory_lots
  for each row execute function public.set_updated_at();

create or replace trigger set_receipts_updated_at
  before update on public.receipts
  for each row execute function public.set_updated_at();

create or replace trigger set_receipt_lines_updated_at
  before update on public.receipt_lines
  for each row execute function public.set_updated_at();

create or replace trigger set_pallets_updated_at
  before update on public.pallets
  for each row execute function public.set_updated_at();

create or replace trigger set_inventory_balances_updated_at
  before update on public.inventory_balances
  for each row execute function public.set_updated_at();

create or replace trigger set_putaway_tasks_updated_at
  before update on public.putaway_tasks
  for each row execute function public.set_updated_at();

create or replace trigger set_move_tasks_updated_at
  before update on public.move_tasks
  for each row execute function public.set_updated_at();

create or replace trigger set_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create or replace trigger set_order_lines_updated_at
  before update on public.order_lines
  for each row execute function public.set_updated_at();

create or replace trigger set_pick_lists_updated_at
  before update on public.pick_lists
  for each row execute function public.set_updated_at();

create or replace trigger set_pick_tasks_updated_at
  before update on public.pick_tasks
  for each row execute function public.set_updated_at();

create or replace trigger set_transfers_updated_at
  before update on public.transfers
  for each row execute function public.set_updated_at();

create or replace trigger set_transfer_lines_updated_at
  before update on public.transfer_lines
  for each row execute function public.set_updated_at();

create or replace trigger set_cycle_counts_updated_at
  before update on public.cycle_counts
  for each row execute function public.set_updated_at();

create or replace trigger set_cycle_count_lines_updated_at
  before update on public.cycle_count_lines
  for each row execute function public.set_updated_at();

create or replace trigger set_stock_adjustments_updated_at
  before update on public.stock_adjustments
  for each row execute function public.set_updated_at();

create or replace trigger set_barcode_labels_updated_at
  before update on public.barcode_labels
  for each row execute function public.set_updated_at();

drop trigger if exists trg_integration_connections_updated on public.integration_connections;
create trigger trg_integration_connections_updated
  before update on public.integration_connections
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_integration_sync_jobs_updated on public.integration_sync_jobs;
create trigger trg_integration_sync_jobs_updated
  before update on public.integration_sync_jobs
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_report_definitions_updated on public.report_definitions;
create trigger trg_report_definitions_updated
  before update on public.report_definitions
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_printer_stations_updated on public.printer_stations;
create trigger trg_printer_stations_updated
  before update on public.printer_stations
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_label_templates_updated on public.label_templates;
create trigger trg_label_templates_updated
  before update on public.label_templates
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_staging_loads_updated on public.staging_loads;
create trigger trg_staging_loads_updated
  before update on public.staging_loads
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_work_templates_updated on public.work_templates;
create trigger trg_work_templates_updated
  before update on public.work_templates
  for each row execute function public.update_updated_at_column();

create or replace trigger set_deployment_subscription_updated_at
  before update on public.deployment_subscription
  for each row execute function public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
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
alter table public.integration_connections enable row level security;
alter table public.external_record_links enable row level security;
alter table public.integration_sync_jobs enable row level security;
alter table public.integration_payload_logs enable row level security;
alter table public.integration_dead_letters enable row level security;
alter table public.report_definitions enable row level security;
alter table public.report_exports enable row level security;
alter table public.printer_stations enable row level security;
alter table public.label_templates enable row level security;
alter table public.print_jobs enable row level security;
alter table public.ai_recommendations enable row level security;
alter table public.quality_inspections enable row level security;
alter table public.return_authorizations enable row level security;
alter table public.dock_appointments enable row level security;
alter table public.staging_loads enable row level security;
alter table public.replenishment_tasks enable row level security;
alter table public.work_templates enable row level security;
alter table public.client_variables enable row level security;
alter table public.system_logs enable row level security;
alter table public.deployment_subscription enable row level security;
alter table public.licence_events enable row level security;

-- ============================================================
-- HELPER FUNCTIONS (RLS-aware, security definer)
-- ============================================================
create or replace function public.has_role(_user_id uuid, _role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = _user_id
      and r.code::text = _role
  );
$$;

create or replace function public.has_any_role(_roles public.app_role_code[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.code = any(_roles)
  );
$$;

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select approved from public.profiles where id = auth.uid()),
    false
  );
$$;

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

create or replace function public.is_operator_for_assignment(assigned_user uuid)
returns boolean
language sql
stable
as $$
  select auth.uid() = assigned_user
    or public.has_any_role(array[
      'admin'::public.app_role_code,
      'warehouse_manager'::public.app_role_code,
      'inventory_clerk'::public.app_role_code
    ]);
$$;

create or replace function public.prevent_self_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approved is distinct from old.approved
     and not exists (
       select 1 from public.user_roles ur
       join public.roles r on r.id = ur.role_id
       where ur.user_id = auth.uid() and r.code = 'admin'
     )
  then
    raise exception 'Only admins can change the approved status';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_approval on public.profiles;
create trigger trg_prevent_self_approval
  before update on public.profiles
  for each row execute function public.prevent_self_approval();

-- Auth trigger (after tables exist)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- roles
create policy "roles read authenticated"
  on public.roles for select
  using (auth.role() = 'authenticated');

create policy "roles admin manage"
  on public.roles for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- profiles
create policy "profiles self read"
  on public.profiles for select
  using (auth.uid() = id or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'warehouse_manager'));

create policy "profiles self update"
  on public.profiles for update
  using (auth.uid() = id or public.has_role(auth.uid(), 'admin'))
  with check (auth.uid() = id or public.has_role(auth.uid(), 'admin'));

create policy "profiles self insert"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- user_roles
create policy "Users read own or admin reads all user_roles"
  on public.user_roles for select
  to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy "Admins can insert user_roles"
  on public.user_roles for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admins can update user_roles"
  on public.user_roles for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admins can delete user_roles"
  on public.user_roles for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Approved-user pattern for all operational WMS tables
do $$
declare
  t text;
  wms_tables text[] := array[
    'warehouses', 'zones', 'locations', 'clients', 'products',
    'product_packaging_profiles', 'inventory_lots',
    'receipts', 'receipt_lines', 'pallets', 'inventory_balances',
    'putaway_tasks', 'move_tasks', 'orders', 'order_lines',
    'pick_lists', 'pick_tasks', 'transfers', 'transfer_lines',
    'cycle_counts', 'cycle_count_lines', 'stock_adjustments',
    'barcode_labels', 'audit_events'
  ];
  pol record;
begin
  foreach t in array wms_tables loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;
    execute format(
      'create policy "Approved users can read %I" on public.%I for select to authenticated using (public.is_approved())',
      t, t
    );
    execute format(
      'create policy "Approved users can insert %I" on public.%I for insert to authenticated with check (public.is_approved())',
      t, t
    );
    execute format(
      'create policy "Approved users can update %I" on public.%I for update to authenticated using (public.is_approved())',
      t, t
    );
    execute format(
      'create policy "Approved users can delete %I" on public.%I for delete to authenticated using (public.is_approved())',
      t, t
    );
  end loop;
end $$;

-- Enterprise tables: read=approved, manage=admin+manager
do $$
declare
  t text;
  enterprise_tables text[] := array[
    'integration_connections', 'external_record_links', 'integration_sync_jobs',
    'integration_payload_logs', 'integration_dead_letters', 'report_definitions',
    'report_exports', 'printer_stations', 'label_templates', 'print_jobs',
    'ai_recommendations', 'quality_inspections', 'return_authorizations',
    'dock_appointments', 'staging_loads', 'replenishment_tasks', 'work_templates',
    'client_variables', 'system_logs'
  ];
  pol record;
begin
  foreach t in array enterprise_tables loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;
    execute format(
      'create policy "Approved users read %I" on public.%I for select to authenticated using (public.is_approved())',
      t, t
    );
    execute format(
      'create policy "Managers manage %I" on public.%I for all to authenticated using (public.has_any_role(array[''admin''::public.app_role_code, ''warehouse_manager''::public.app_role_code])) with check (public.has_any_role(array[''admin''::public.app_role_code, ''warehouse_manager''::public.app_role_code]))',
      t, t
    );
  end loop;
end $$;

-- deployment_subscription: admin only
create policy "Admins read deployment_subscription"
  on public.deployment_subscription for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins manage deployment_subscription"
  on public.deployment_subscription for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- licence_events: admin read; insert via security definer function only
create policy "Admins read licence_events"
  on public.licence_events for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
insert into storage.buckets (id, name, public)
values
  ('labels',      'labels',      false),
  ('imports',     'imports',     false),
  ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "Storage access authenticated"
  on storage.objects for all
  using (
    bucket_id in ('labels', 'imports', 'attachments')
    and auth.role() = 'authenticated'
  )
  with check (
    bucket_id in ('labels', 'imports', 'attachments')
    and auth.role() = 'authenticated'
  );

-- ============================================================
-- VIEWS
-- ============================================================
create or replace view public.inventory_search_view
with (security_invoker = true) as
select
  ib.id as inventory_balance_id,
  p.pallet_code,
  p.pallet_barcode,
  pr.sku,
  pr.name as product_name,
  pr.barcode as product_barcode,
  c.code as client_code,
  c.name as client_name,
  il.lot_number,
  il.batch_number,
  il.expiry_date,
  il.manufacture_date,
  w.code as warehouse_code,
  w.name as warehouse_name,
  z.code as zone_code,
  z.name as zone_name,
  l.code as location_code,
  ib.status,
  ib.quantity,
  ib.available_quantity,
  ib.reserved_quantity,
  ib.held_quantity,
  ib.damaged_quantity,
  ib.received_at,
  p.length,
  p.width,
  p.height,
  p.weight,
  pr.temperature_requirement,
  pr.product_family,
  pr.rotation_method
from public.inventory_balances ib
join public.pallets p on p.id = ib.pallet_id
join public.products pr on pr.id = ib.product_id
left join public.clients c on c.id = ib.client_id
left join public.inventory_lots il on il.id = ib.inventory_lot_id
join public.warehouses w on w.id = ib.warehouse_id
left join public.zones z on z.id = ib.zone_id
left join public.locations l on l.id = ib.location_id;

create or replace view public.location_occupancy_view
with (security_invoker = true) as
select
  l.id as location_id,
  l.code as location_code,
  l.temperature_class,
  l.max_pallets,
  l.location_type,
  w.code as warehouse_code,
  z.code as zone_code,
  count(ib.id)::integer as occupied_pallets,
  (count(ib.id) >= l.max_pallets) as is_full
from public.locations l
join public.warehouses w on w.id = l.warehouse_id
join public.zones z on z.id = l.zone_id
left join public.inventory_balances ib on ib.location_id = l.id
group by l.id, l.code, l.temperature_class, l.max_pallets, l.location_type, w.code, z.code;

-- ============================================================
-- OPERATIONAL FUNCTIONS
-- ============================================================
create or replace function public.log_audit_event(
  in_event_type      text,
  in_entity_table    text,
  in_entity_id       uuid,
  in_warehouse_id    uuid default null,
  in_pallet_id       uuid default null,
  in_from_location_id uuid default null,
  in_to_location_id  uuid default null,
  in_metadata        jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_id uuid;
begin
  insert into public.audit_events (
    event_type, entity_table, entity_id, warehouse_id,
    pallet_id, from_location_id, to_location_id, actor_user_id, metadata
  )
  values (
    in_event_type, in_entity_table, in_entity_id, in_warehouse_id,
    in_pallet_id, in_from_location_id, in_to_location_id, auth.uid(), in_metadata
  )
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.directed_putaway_candidates(in_pallet_id uuid)
returns table (
  location_id   uuid,
  location_code text,
  score         numeric,
  reason        text
)
language sql
stable
as $$
  with pallet_context as (
    select p.id, p.client_id, p.product_id, p.length, p.width, p.height, p.weight,
           p.current_warehouse_id as warehouse_id,
           pr.product_family, pr.temperature_requirement
    from public.pallets p
    join public.products pr on pr.id = p.product_id
    where p.id = in_pallet_id
  ),
  location_fill as (
    select ib.location_id,
           count(*) as pallet_count,
           bool_or(ib.product_id <> pc.product_id) as has_other_sku,
           bool_or(ib.client_id <> pc.client_id) as has_other_client
    from public.inventory_balances ib
    join pallet_context pc on true
    where ib.location_id is not null
      and ib.status::text not in ('in_transit', 'missing', 'shipped')
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

create or replace function public.resolve_login_code(in_login_code text)
returns text
language sql
security definer
set search_path = public
as $$
  select email
  from public.profiles
  where active = true
    and approved = true
    and (
      upper(coalesce(user_code, '')) = upper(trim(in_login_code))
      or upper(coalesce(badge_code, '')) = upper(trim(in_login_code))
    )
  limit 1;
$$;

create or replace function public.admin_invite_user(
  in_email       text,
  in_full_name   text,
  in_password    text,
  in_role_code   text default null,
  in_warehouse_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_user_id uuid;
  role_id     uuid;
  caller_role text;
begin
  select r.code into caller_role
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid() and r.code = 'admin'
  limit 1;

  if caller_role is null then
    raise exception 'Only admins can invite users';
  end if;

  if exists (select 1 from auth.users where email = in_email) then
    raise exception 'A user with that email already exists';
  end if;

  new_user_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    new_user_id, 'authenticated', 'authenticated',
    lower(trim(in_email)),
    crypt(in_password, gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', in_full_name),
    timezone('utc', now()),
    timezone('utc', now())
  );

  update public.profiles
  set approved  = true,
      active    = true,
      full_name = coalesce(nullif(trim(in_full_name), ''), full_name)
  where id = new_user_id;

  if in_role_code is not null and in_role_code <> '' then
    select id into role_id from public.roles where code = in_role_code::public.app_role_code;
    if role_id is not null then
      insert into public.user_roles (user_id, role_id, warehouse_id)
      values (new_user_id, role_id, in_warehouse_id)
      on conflict do nothing;
    end if;
  end if;

  return new_user_id;
end;
$$;

create or replace function public.write_system_log(
  in_log_type     text,
  in_severity     text,
  in_title        text,
  in_message      text default null,
  in_details      jsonb default null,
  in_source       text default null,
  in_table_name   text default null,
  in_record_count bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_id uuid;
begin
  insert into public.system_logs (
    log_type, severity, title, message, details,
    source, table_name, record_count, created_by
  )
  values (
    in_log_type, in_severity, in_title, in_message, in_details,
    in_source, in_table_name, in_record_count, auth.uid()
  )
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.reset_wms_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can reset the WMS environment';
  end if;

  update public.profiles set default_warehouse_id = null where default_warehouse_id is not null;

  update public.user_roles
  set warehouse_id  = null,
      is_hidden     = false,
      hidden_at     = null,
      hidden_reason = null;

  truncate table
    public.ai_recommendations,
    public.integration_payload_logs,
    public.integration_dead_letters,
    public.integration_sync_jobs,
    public.external_record_links,
    public.integration_connections,
    public.report_exports,
    public.report_definitions,
    public.print_jobs,
    public.label_templates,
    public.printer_stations,
    public.work_templates,
    public.client_variables,
    public.system_logs
  restart identity cascade;

  truncate table
    public.audit_events,
    public.barcode_labels,
    public.stock_adjustments,
    public.cycle_count_lines,
    public.cycle_counts,
    public.staging_loads,
    public.dock_appointments,
    public.replenishment_tasks,
    public.quality_inspections,
    public.return_authorizations,
    public.transfer_lines,
    public.transfers,
    public.pick_tasks,
    public.pick_lists,
    public.order_lines,
    public.orders,
    public.move_tasks,
    public.putaway_tasks,
    public.inventory_balances,
    public.pallets,
    public.receipt_lines,
    public.receipts,
    public.inventory_lots,
    public.product_packaging_profiles,
    public.products,
    public.clients,
    public.locations,
    public.zones,
    public.warehouses
  restart identity cascade;

  return jsonb_build_object(
    'status', 'ok',
    'message', 'Warehouse data reset complete. Launch the setup wizard to rebuild the environment.'
  );
end;
$$;

create or replace function public.run_warehouse_setup(
  setup_payload jsonb,
  seed_mode text default 'starter_ops'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user             uuid := auth.uid();
  warehouse_item         jsonb;
  zone_item              jsonb;
  template_item          jsonb;
  warehouse_row          record;
  starter_client         record;
  warehouse_id           uuid;
  zone_id                uuid;
  source_warehouse_id    uuid;
  destination_warehouse_id uuid;
  staging_location_id    uuid;
  dispatch_location_id   uuid;
  storage_location_id    uuid;
  receiving_location_id  uuid;
  cool_location_id       uuid;
  client_id              uuid;
  product_id             uuid;
  packaging_profile_id   uuid;
  receipt_id             uuid;
  receipt_line_id        uuid;
  pallet_id              uuid;
  pick_order_id          uuid;
  pick_list_id           uuid;
  transfer_id            uuid;
  cycle_count_id         uuid;
  generated_locations    integer := 0;
  warehouses_created     integer := 0;
  zones_created          integer := 0;
  letter_index           integer;
  bay_index              integer;
  level_index            integer;
  aisle_code             text;
  location_code          text;
begin
  if actor_user is null or not public.has_role(actor_user, 'admin') then
    raise exception 'Only admins can run warehouse setup';
  end if;

  for warehouse_item in
    select value from jsonb_array_elements(coalesce(setup_payload -> 'warehouses', '[]'::jsonb))
  loop
    insert into public.warehouses (code, name, city, country, has_cool_zone, active, created_by)
    values (
      upper(trim(warehouse_item ->> 'code')),
      trim(warehouse_item ->> 'name'),
      nullif(trim(warehouse_item ->> 'city'), ''),
      coalesce(nullif(trim(warehouse_item ->> 'country'), ''), 'Barbados'),
      coalesce((warehouse_item ->> 'hasCoolZone')::boolean, false),
      true,
      actor_user
    )
    on conflict (code) do update
      set name          = excluded.name,
          city          = excluded.city,
          country       = excluded.country,
          has_cool_zone = excluded.has_cool_zone,
          active        = excluded.active,
          updated_at    = now()
    returning id into warehouse_id;
    warehouses_created := warehouses_created + 1;
  end loop;

  for zone_item in
    select value from jsonb_array_elements(coalesce(setup_payload -> 'zones', '[]'::jsonb))
  loop
    select id into warehouse_id from public.warehouses
    where code = upper(trim(zone_item ->> 'warehouseCode'));

    if warehouse_id is null then
      raise exception 'Zone references unknown warehouse code %', zone_item ->> 'warehouseCode';
    end if;

    insert into public.zones (
      warehouse_id, code, name, temperature_class,
      is_staging, is_dispatch, is_quarantine, sort_order, created_by
    )
    values (
      warehouse_id,
      upper(trim(zone_item ->> 'code')),
      trim(zone_item ->> 'name'),
      coalesce((zone_item ->> 'temperatureClass')::public.temperature_class, 'ambient'),
      coalesce((zone_item ->> 'isStaging')::boolean, false),
      coalesce((zone_item ->> 'isDispatch')::boolean, false),
      coalesce((zone_item ->> 'isQuarantine')::boolean, false),
      coalesce((zone_item ->> 'sortOrder')::integer, 0),
      actor_user
    )
    on conflict (warehouse_id, code) do update
      set name              = excluded.name,
          temperature_class = excluded.temperature_class,
          is_staging        = excluded.is_staging,
          is_dispatch       = excluded.is_dispatch,
          is_quarantine     = excluded.is_quarantine,
          sort_order        = excluded.sort_order,
          updated_at        = now()
    returning id into zone_id;
    zones_created := zones_created + 1;
  end loop;

  for template_item in
    select value from jsonb_array_elements(coalesce(setup_payload -> 'locationTemplates', '[]'::jsonb))
  loop
    select w.id, z.id into warehouse_id, zone_id
    from public.warehouses w
    join public.zones z on z.warehouse_id = w.id
    where w.code = upper(trim(template_item ->> 'warehouseCode'))
      and z.code = upper(trim(template_item ->> 'zoneCode'));

    if warehouse_id is null or zone_id is null then
      raise exception 'Location template references unknown warehouse/zone pair % / %',
        template_item ->> 'warehouseCode', template_item ->> 'zoneCode';
    end if;

    for letter_index in 1..greatest(coalesce((template_item ->> 'aisleCount')::integer, 1), 1) loop
      aisle_code := chr(64 + least(letter_index, 26));
      for bay_index in 1..greatest(coalesce((template_item ->> 'baysPerAisle')::integer, 1), 1) loop
        for level_index in 1..greatest(coalesce((template_item ->> 'levels')::integer, 1), 1) loop
          location_code := format('%s-%s-%s-%02s-L%02s',
            upper(trim(template_item ->> 'warehouseCode')),
            upper(trim(template_item ->> 'zoneCode')),
            aisle_code, bay_index, level_index);

          insert into public.locations (
            warehouse_id, zone_id, code, aisle, bay, level, depth,
            location_type, temperature_class, max_pallets,
            mixed_sku_allowed, mixed_lot_allowed, pick_sequence, putaway_sequence, status, created_by
          )
          values (
            warehouse_id, zone_id, location_code, aisle_code,
            lpad(bay_index::text, 2, '0'), level_index, 1,
            coalesce((template_item ->> 'locationType')::public.location_type, 'rack'),
            coalesce((template_item ->> 'temperatureClass')::public.temperature_class, 'ambient'),
            greatest(coalesce((template_item ->> 'maxPallets')::integer, 1), 1),
            coalesce((template_item ->> 'mixedSkuAllowed')::boolean, false),
            coalesce((template_item ->> 'mixedLotAllowed')::boolean, false),
            (letter_index * 1000) + (bay_index * 10) + level_index,
            (letter_index * 1000) + (bay_index * 10) + level_index,
            coalesce(nullif(template_item ->> 'status', ''), 'active'),
            actor_user
          )
          on conflict (code) do nothing;

          generated_locations := generated_locations + 1;
        end loop;
      end loop;
    end loop;
  end loop;

  if coalesce(seed_mode, 'starter_ops') = 'starter_ops'
     and not exists (select 1 from public.clients limit 1)
  then
    insert into public.clients (code, name, require_expiry, active, created_by)
    values
      ('GEN',  'General Merchandise', false, true, actor_user),
      ('COLD', 'Cold Chain Foods',    true,  true, actor_user);

    for starter_client in
      select c.id, row_number() over (order by c.code) as idx, c.code
      from public.clients c order by c.code
    loop
      insert into public.products (
        sku, barcode, name, description, client_owner_id, product_family,
        temperature_requirement, lot_tracked, batch_tracked, expiry_tracked,
        rotation_method, active, created_by
      )
      values (
        format('SKU-%s-01', starter_client.code),
        format('28%s000001', starter_client.idx),
        format('%s Starter Product', starter_client.code),
        'Starter product seeded by the warehouse setup wizard.',
        starter_client.id,
        case when starter_client.code = 'COLD' then 'Cold Chain' else 'General' end,
        case when starter_client.code = 'COLD' then 'cool'::public.temperature_class else 'ambient'::public.temperature_class end,
        true, false, starter_client.code = 'COLD',
        case when starter_client.code = 'COLD' then 'fefo'::public.rotation_method else 'fifo'::public.rotation_method end,
        true, actor_user
      )
      returning id into product_id;

      insert into public.product_packaging_profiles (
        product_id, profile_name, package_type, units_per_package,
        length, width, height, weight, is_default, created_by
      )
      values (
        product_id, 'Default', 'pallet', 48, 120, 100,
        case when starter_client.code = 'COLD' then 150 else 175 end,
        case when starter_client.code = 'COLD' then 700 else 850 end,
        true, actor_user
      )
      returning id into packaging_profile_id;
    end loop;

    for warehouse_row in select * from public.warehouses order by code loop
      select l.id into staging_location_id from public.locations l
      join public.zones z on z.id = l.zone_id
      where l.warehouse_id = warehouse_row.id and z.is_staging = true
      order by l.code limit 1;

      select l.id into dispatch_location_id from public.locations l
      join public.zones z on z.id = l.zone_id
      where l.warehouse_id = warehouse_row.id and z.is_dispatch = true
      order by l.code limit 1;

      select l.id into storage_location_id from public.locations l
      join public.zones z on z.id = l.zone_id
      where l.warehouse_id = warehouse_row.id
        and z.is_staging = false and z.is_dispatch = false and z.is_quarantine = false
        and l.temperature_class = 'ambient'
      order by l.code limit 1;

      select l.id into cool_location_id from public.locations l
      where l.warehouse_id = warehouse_row.id and l.temperature_class = 'cool'
      order by l.code limit 1;

      receiving_location_id := coalesce(staging_location_id, storage_location_id, dispatch_location_id, cool_location_id);

      select c.id into client_id from public.clients c where c.code = 'GEN';
      select p.id into product_id from public.products p where p.sku = 'SKU-GEN-01';
      select ppf.id into packaging_profile_id from public.product_packaging_profiles ppf
      where ppf.product_id = product_id limit 1;

      insert into public.receipts (
        receipt_number, receipt_type, reference_number, warehouse_id,
        client_id, status, notes, created_by
      )
      values (
        format('RCT-%s-01', warehouse_row.code), 'po',
        format('SETUP-%s-01', warehouse_row.code),
        warehouse_row.id, client_id, 'queued', 'Starter receipt awaiting putaway.', actor_user
      )
      returning id into receipt_id;

      insert into public.receipt_lines (
        receipt_id, product_id, packaging_profile_id, client_id,
        quantity, received_quantity, notes, created_by
      )
      values (receipt_id, product_id, packaging_profile_id, client_id, 24, 24, 'Starter receipt line.', actor_user)
      returning id into receipt_line_id;

      insert into public.pallets (
        pallet_code, pallet_barcode, product_id, client_id, receipt_line_id,
        current_location_id, current_warehouse_id, packaging_profile_id,
        quantity, available_quantity, status, is_stored, created_by
      )
      values (
        format('PLT-%s-01', warehouse_row.code), format('PBC-%s-01', warehouse_row.code),
        product_id, client_id, receipt_line_id, null, warehouse_row.id,
        packaging_profile_id, 24, 24, 'receiving', false, actor_user
      )
      returning id into pallet_id;

      insert into public.inventory_balances (
        pallet_id, product_id, client_id, warehouse_id, location_id, status, quantity, available_quantity
      )
      values (pallet_id, product_id, client_id, warehouse_row.id, null, 'receiving', 24, 24);

      if receiving_location_id is not null then
        insert into public.putaway_tasks (
          task_number, pallet_id, warehouse_id, suggested_location_id,
          assigned_user_id, status, created_by
        )
        values (
          format('PTA-%s-01', warehouse_row.code), pallet_id, warehouse_row.id,
          receiving_location_id, actor_user, 'queued', actor_user
        );
      end if;

      if storage_location_id is not null then
        insert into public.pallets (
          pallet_code, pallet_barcode, product_id, client_id, current_location_id,
          current_warehouse_id, packaging_profile_id, quantity, available_quantity,
          status, is_stored, created_by
        )
        values (
          format('PLT-%s-02', warehouse_row.code), format('PBC-%s-02', warehouse_row.code),
          product_id, client_id, storage_location_id, warehouse_row.id,
          packaging_profile_id, 18, 18, 'available', true, actor_user
        )
        returning id into pallet_id;

        insert into public.inventory_balances (
          pallet_id, product_id, client_id, warehouse_id,
          zone_id, location_id, status, quantity, available_quantity
        )
        select pallet_id, product_id, client_id, warehouse_row.id,
               l.zone_id, storage_location_id, 'available', 18, 18
        from public.locations l where l.id = storage_location_id;
      end if;
    end loop;

    select w.id into source_warehouse_id from public.warehouses w order by w.code limit 1;
    select w.id into destination_warehouse_id from public.warehouses w order by w.code offset 1 limit 1;

    if source_warehouse_id is not null then
      select c.id into client_id from public.clients c where c.code = 'GEN';
      select p.id into product_id from public.products p where p.sku = 'SKU-GEN-01';
      select l.id into dispatch_location_id from public.locations l
      join public.zones z on z.id = l.zone_id
      where l.warehouse_id = source_warehouse_id and z.is_dispatch = true
      order by l.code limit 1;

      insert into public.orders (
        order_number, order_type, client_id, warehouse_id, status,
        requested_ship_date, notes, created_by
      )
      values (
        'ORD-SETUP-01', 'sales', client_id, source_warehouse_id, 'queued',
        current_date + 1, 'Starter outbound order.', actor_user
      )
      returning id into pick_order_id;

      insert into public.pick_lists (
        pick_list_number, warehouse_id, client_id, order_id,
        consolidated, status, released_at, notes, created_by
      )
      values (
        'PKL-SETUP-01', source_warehouse_id, client_id, pick_order_id,
        false, 'queued', timezone('utc', now()), 'Starter pick list.', actor_user
      )
      returning id into pick_list_id;

      select ib.pallet_id, ib.location_id into pallet_id, storage_location_id
      from public.inventory_balances ib
      where ib.warehouse_id = source_warehouse_id and ib.status = 'available'
      order by ib.created_at limit 1;

      if pallet_id is not null then
        insert into public.order_lines (order_id, product_id, quantity, allocated_quantity, notes, created_by)
        values (pick_order_id, product_id, 6, 6, 'Starter order line.', actor_user);

        insert into public.pick_tasks (
          task_number, pick_list_id, pallet_id, location_id, staging_location_id,
          assigned_user_id, requested_quantity, status, created_by
        )
        values (
          'PKT-SETUP-01', pick_list_id, pallet_id, storage_location_id,
          dispatch_location_id, actor_user, 6, 'queued', actor_user
        );
      end if;
    end if;

    if source_warehouse_id is not null and destination_warehouse_id is not null then
      select ib.pallet_id into pallet_id from public.inventory_balances ib
      where ib.warehouse_id = source_warehouse_id and ib.status = 'available'
      order by ib.created_at limit 1;

      if pallet_id is not null then
        insert into public.transfers (
          transfer_number, transfer_type, source_warehouse_id, destination_warehouse_id,
          status, notes, created_by
        )
        values (
          'TRF-SETUP-01', 'inter_warehouse', source_warehouse_id, destination_warehouse_id,
          'queued', 'Starter replenishment transfer.', actor_user
        )
        returning id into transfer_id;

        insert into public.transfer_lines (transfer_id, pallet_id, product_id, client_id, quantity, created_by)
        select transfer_id, pallet_id, ib.product_id, ib.client_id, least(ib.available_quantity, 6), actor_user
        from public.inventory_balances ib where ib.pallet_id = pallet_id;
      end if;
    end if;

    if source_warehouse_id is not null then
      insert into public.cycle_counts (
        count_number, warehouse_id, scope, status, assigned_user_id,
        variance_threshold_percent, notes, created_by
      )
      values (
        'CNT-SETUP-01', source_warehouse_id, 'spot', 'queued',
        actor_user, 5, 'Starter cycle count.', actor_user
      )
      returning id into cycle_count_id;

      insert into public.cycle_count_lines (
        cycle_count_id, location_id, product_id, pallet_id,
        expected_quantity, counted_quantity, variance_quantity, variance_percent,
        status, notes, created_by
      )
      select cycle_count_id, ib.location_id, ib.product_id, ib.pallet_id,
             ib.quantity, ib.quantity, 0, 0, 'queued', 'Starter cycle count line.', actor_user
      from public.inventory_balances ib
      where ib.warehouse_id = source_warehouse_id
      order by ib.created_at limit 1;
    end if;

    insert into public.audit_events (
      event_type, entity_table, entity_id, warehouse_id, actor_user_id, metadata
    )
    select 'receipt', 'warehouses', w.id, w.id, actor_user,
           jsonb_build_object('setup_seeded', true, 'warehouse_code', w.code)
    from public.warehouses w;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'warehouses_created', warehouses_created,
    'zones_created', zones_created,
    'locations_created', generated_locations,
    'seed_mode', coalesce(seed_mode, 'starter_ops')
  );
end;
$$;

-- ============================================================
-- SUBSCRIPTION & LICENCE FUNCTIONS (new)
-- ============================================================
create or replace function public.get_deployment_licence()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(ds)
  from public.deployment_subscription ds
  where ds.is_active = true
  order by ds.created_at desc
  limit 1;
$$;

create or replace function public.is_licence_valid()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.deployment_subscription
    where is_active = true
      and (licence_valid_until is null or licence_valid_until > now())
      and (expires_at is null or expires_at > now())
  );
$$;

create or replace function public.record_licence_event(
  in_event_type text,
  in_metadata   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id  uuid;
  sub_id  uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can record licence events';
  end if;

  select id into sub_id from public.deployment_subscription
  where is_active = true order by created_at desc limit 1;

  insert into public.licence_events (subscription_id, event_type, metadata, created_by)
  values (sub_id, in_event_type, in_metadata, auth.uid())
  returning id into new_id;

  return new_id;
end;
$$;

-- ============================================================
-- FUNCTION GRANTS & REVOKES
-- ============================================================
revoke execute on function public.has_role(uuid, text) from anon, public;
revoke execute on function public.has_any_role(app_role_code[]) from anon, public;
revoke execute on function public.is_approved() from anon, public;
revoke execute on function public.handle_new_user() from anon, public, authenticated;
revoke execute on function public.update_updated_at_column() from anon, public, authenticated;
revoke execute on function public.prevent_self_approval() from anon, public, authenticated;

grant execute on function public.has_role(uuid, text) to authenticated;
grant execute on function public.has_any_role(app_role_code[]) to authenticated;
grant execute on function public.is_approved() to authenticated;
grant execute on function public.resolve_login_code(text) to anon, authenticated;
grant execute on function public.admin_invite_user to authenticated;
grant execute on function public.write_system_log to authenticated;
grant execute on function public.get_deployment_licence() to authenticated;
grant execute on function public.is_licence_valid() to authenticated;
grant execute on function public.record_licence_event(text, jsonb) to authenticated;

-- ============================================================
-- INITIAL REFERENCE DATA
-- ============================================================
insert into public.roles (code, name, description)
values
  ('admin',             'Admin',             'Full access across the entire warehouse management system'),
  ('warehouse_manager', 'Warehouse Manager', 'Full operational access across warehouses'),
  ('inventory_clerk',   'Inventory Clerk',   'Receiving, search, cycle counts, and routine movements'),
  ('warehouse_operator','Warehouse Operator','Assigned task execution and limited operational visibility'),
  ('dispatch_driver',   'Dispatch Driver',   'Confirms transfer dispatches and receives stock between facilities')
on conflict (code) do update
  set name        = excluded.name,
      description = excluded.description,
      updated_at  = timezone('utc', now());

insert into public.report_definitions (code, name, audience, filters, columns)
values
  (
    'expiration-risk', 'Expiration Risk',
    array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code],
    '{"days": 30}'::jsonb,
    '["sku","lot","expiry_date","available_quantity","warehouse","location"]'::jsonb
  ),
  (
    'low-stock', 'Low Stock Warnings',
    array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code],
    '{"threshold": 10}'::jsonb,
    '["sku","available_quantity","warehouse","location","netsuite_status"]'::jsonb
  ),
  (
    'six-sigma-variance', 'Six Sigma Variance',
    array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code],
    '{}'::jsonb,
    '["count_number","sku","variance_quantity","variance_percent","root_cause_code"]'::jsonb
  )
on conflict (code) do nothing;

insert into public.label_templates (code, label_type, printer_language, template_body)
values
  (
    'zpl-pallet-default', 'pallet', 'zpl',
    '^XA^CI28^PW609^LL406^FO28,24^GB553,358,3^FS^FO40,44^A0N,36,36^FD{{title}}^FS^FO40,134^BY2,3,88^BCN,88,Y,N,N^FD{{code}}^FS^XZ'
  ),
  (
    'zpl-location-default', 'location', 'zpl',
    '^XA^CI28^PW609^LL300^FO32,32^A0N,42,42^FD{{location_code}}^FS^FO32,100^BY2,3,100^BCN,100,Y,N,N^FD{{location_code}}^FS^XZ'
  )
on conflict (code) do nothing;
