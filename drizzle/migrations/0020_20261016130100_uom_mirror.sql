-- NetSuite units of measure mirrored into WW (outbound picking design, slice A
-- / D6, D9).
--
-- NetSuite `unitstype` is a packaging recipe (e.g. BL-6BG: base BAG, BALES = 6
-- bags) and `unitstypeuom` its units. uom_types / uom_units mirror them one to
-- one, keyed by NetSuite internal id, and are written only by the
-- netsuite-units edge function (service role). WW quantities stay in integer
-- base units; conversion_rate converts to a sales-order line unit at posting.
--
-- products gains the item's unit type and its stock/sale/purchase units.
-- Additive only.

create table if not exists public.uom_types (
  id                  uuid primary key default gen_random_uuid(),
  ns_internal_id      text not null unique,
  name                text not null,
  is_inactive         boolean not null default false,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists uom_types_name_idx on public.uom_types (name);

create table if not exists public.uom_units (
  id                  uuid primary key default gen_random_uuid(),
  uom_type_id         uuid not null references public.uom_types (id) on delete cascade,
  ns_internal_id      text not null unique,
  unit_name           text not null,
  plural_name         text,
  abbreviation        text,
  plural_abbreviation text,
  -- Base units per one of this unit. Integers in the Simplex sandbox, numeric
  -- so a fractional recipe never truncates.
  conversion_rate     numeric(18,6) not null default 1 check (conversion_rate > 0),
  is_base             boolean not null default false,
  in_use              boolean not null default true,
  -- Filled from unit_name / abbreviation by the trigger below when null; an
  -- admin may override it and a re-import keeps the override.
  package_type_id     uuid references public.package_types (id) on delete set null,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists uom_units_type_idx on public.uom_units (uom_type_id);
create index if not exists uom_units_package_type_idx on public.uom_units (package_type_id);
-- NetSuite allows exactly one base unit per type (0 exceptions in 327 types on
-- 2026-10-16). Not a unique index: a re-import that moves the base unit
-- upserts row by row and would trip it mid-statement.
create index if not exists uom_units_base_idx on public.uom_units (uom_type_id) where is_base;

drop trigger if exists set_uom_types_updated_at on public.uom_types;
create trigger set_uom_types_updated_at
  before update on public.uom_types
  for each row execute function public.set_updated_at();

drop trigger if exists set_uom_units_updated_at on public.uom_units;
create trigger set_uom_units_updated_at
  before update on public.uom_units
  for each row execute function public.set_updated_at();

create or replace function public.fill_uom_unit_package_type()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.package_type_id is null then
    new.package_type_id := coalesce(
      public.resolve_package_type_id(new.unit_name),
      public.resolve_package_type_id(new.abbreviation),
      public.resolve_package_type_id(new.plural_name)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists fill_uom_unit_package_type on public.uom_units;
create trigger fill_uom_unit_package_type
  before insert or update on public.uom_units
  for each row execute function public.fill_uom_unit_package_type();

-- Read by every approved user; written by the service role (no write policy).
alter table public.uom_types enable row level security;
alter table public.uom_units enable row level security;

drop policy if exists "Approved users can read uom_types" on public.uom_types;
create policy "Approved users can read uom_types" on public.uom_types
  for select to authenticated using (public.is_approved());

drop policy if exists "Approved users can read uom_units" on public.uom_units;
create policy "Approved users can read uom_units" on public.uom_units
  for select to authenticated using (public.is_approved());

-- ============================================================
-- products: unit type and stock / sale / purchase units
-- ============================================================
alter table public.products
  add column if not exists uom_type_id      uuid references public.uom_types (id) on delete set null,
  add column if not exists stock_unit_id    uuid references public.uom_units (id) on delete set null,
  add column if not exists sale_unit_id     uuid references public.uom_units (id) on delete set null,
  add column if not exists purchase_unit_id uuid references public.uom_units (id) on delete set null;

create index if not exists idx_products_uom_type on public.products (uom_type_id);

comment on column public.products.uom_type_id is 'NetSuite item unitstype, mirrored by netsuite-units.';
comment on column public.products.stock_unit_id is 'NetSuite item stockunit. WW quantities are still held in base units.';
comment on column public.products.sale_unit_id is 'NetSuite item saleunit (default SO line unit).';
comment on column public.products.purchase_unit_id is 'NetSuite item purchaseunit.';

-- Bulk backfill used by netsuite-units. p_rows is a JSON array of
-- { product_id, unitstype, stockunit, saleunit, purchaseunit } where the last
-- four are NetSuite internal ids. Unknown ids resolve to null. Returns the
-- number of products updated.
create or replace function public.apply_netsuite_product_units(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  with src as (
    select
      (r->>'product_id')::uuid as product_id,
      nullif(r->>'unitstype', '') as type_ns,
      nullif(r->>'stockunit', '') as stock_ns,
      nullif(r->>'saleunit', '') as sale_ns,
      nullif(r->>'purchaseunit', '') as purchase_ns
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  ), resolved as (
    select
      s.product_id,
      t.id as uom_type_id,
      (select u.id from public.uom_units u where u.ns_internal_id = s.stock_ns) as stock_unit_id,
      (select u.id from public.uom_units u where u.ns_internal_id = s.sale_ns) as sale_unit_id,
      (select u.id from public.uom_units u where u.ns_internal_id = s.purchase_ns) as purchase_unit_id
    from src s
    left join public.uom_types t on t.ns_internal_id = s.type_ns
  )
  update public.products p
  set uom_type_id = r.uom_type_id,
      stock_unit_id = r.stock_unit_id,
      sale_unit_id = r.sale_unit_id,
      purchase_unit_id = r.purchase_unit_id
  from resolved r
  where p.id = r.product_id
    and (
      p.uom_type_id is distinct from r.uom_type_id
      or p.stock_unit_id is distinct from r.stock_unit_id
      or p.sale_unit_id is distinct from r.sale_unit_id
      or p.purchase_unit_id is distinct from r.purchase_unit_id
    );
  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function public.apply_netsuite_product_units(jsonb) from public, anon, authenticated;
grant execute on function public.apply_netsuite_product_units(jsonb) to service_role;
