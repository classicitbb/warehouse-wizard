-- Pallet Pack Standards — Phase 1 schema.
--
-- Turns `product_packaging_profiles` from a package-dimension template into the
-- pallet build standard for a SKU: "6 x 8" meaning six cases per layer, eight
-- layers, forty-eight cases.
--
-- Two unit boundaries this migration exists to keep straight:
--
--   * The profile's own `length` / `width` / `height` / `weight` columns are
--     numeric centimetres/kilograms by convention and still feed the existing
--     UI. They are left alone. New explicit millimetre columns carry the
--     package dimensions for anything the height rule touches, backfilled from
--     the legacy columns, and `standard_height_mm` is generated from those —
--     never from the cm column, which would mix units.
--   * `locations.max_height` and `max_pallet_height_cm` are centimetres and are
--     read as centimetres by the legacy paths. `max_height_mm` is added
--     alongside, backfilled, and the new rules read it. Nothing rewrites the
--     legacy columns.
--
-- Additive only. Every existing profile keeps working: the layer columns are
-- null, so every derived column resolves to null and nothing changes for a
-- profile that has not been given a build standard.

-- ── product_packaging_profiles: the build standard ───────────────────────────

alter table public.product_packaging_profiles
  add column if not exists packages_per_layer          integer,
  add column if not exists layers_per_pallet           integer,
  add column if not exists layer_pattern               text default 'block',
  add column if not exists layer_columns               integer,
  add column if not exists package_length_mm           integer,
  add column if not exists package_width_mm            integer,
  add column if not exists package_height_mm           integer,
  add column if not exists pallet_footprint_length_mm  integer,
  add column if not exists pallet_footprint_width_mm   integer,
  add column if not exists pallet_base_height_mm       integer default 145,
  add column if not exists slip_sheet_height_mm        integer default 0,
  add column if not exists pallet_tare_kg              numeric(12,2),
  add column if not exists max_stack_pallets           integer default 1,
  add column if not exists quantity_tolerance          integer default 0,
  add column if not exists is_pallet_standard          boolean not null default false,
  add column if not exists build_notes                 text,
  add column if not exists revision                    integer not null default 1,
  add column if not exists superseded_by_id            uuid references public.product_packaging_profiles (id) on delete set null,
  add column if not exists effective_from              date,
  add column if not exists fit_status                  text,
  add column if not exists fit_checked_at              timestamptz,
  add column if not exists fit_summary                 jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_packaging_profiles'::regclass
      and conname = 'product_packaging_profiles_layer_pattern_check'
  ) then
    alter table public.product_packaging_profiles
      add constraint product_packaging_profiles_layer_pattern_check
      check (layer_pattern is null or layer_pattern in ('block', 'brick', 'pinwheel', 'column', 'custom'));
  end if;
end
$$;

-- Backfill the package millimetre columns from the legacy centimetre columns.
-- Runs before the generated columns are added so they compute from real values.
update public.product_packaging_profiles
   set package_length_mm = round(length * 10)::int
 where length is not null and package_length_mm is null;

update public.product_packaging_profiles
   set package_width_mm = round(width * 10)::int
 where width is not null and package_width_mm is null;

update public.product_packaging_profiles
   set package_height_mm = round(height * 10)::int
 where height is not null and package_height_mm is null;

-- The Packaging Profiles form still writes only the centimetre columns until
-- the Phase 2 form lands, so a profile created after this migration would keep
-- null millimetre columns and never derive a standard height. This keeps the
-- millimetre columns following the centimetre ones unless the writer sets them
-- explicitly in the same statement, which is what the Phase 2 form will do.
create or replace function public.sync_packaging_profile_package_mm()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.package_length_mm is null
     or (tg_op = 'UPDATE'
         and new.length is distinct from old.length
         and new.package_length_mm is not distinct from old.package_length_mm) then
    new.package_length_mm := round(new.length * 10)::int;
  end if;
  if new.package_width_mm is null
     or (tg_op = 'UPDATE'
         and new.width is distinct from old.width
         and new.package_width_mm is not distinct from old.package_width_mm) then
    new.package_width_mm := round(new.width * 10)::int;
  end if;
  if new.package_height_mm is null
     or (tg_op = 'UPDATE'
         and new.height is distinct from old.height
         and new.package_height_mm is not distinct from old.package_height_mm) then
    new.package_height_mm := round(new.height * 10)::int;
  end if;
  return new;
end;
$$;

drop trigger if exists product_packaging_profiles_package_mm_sync on public.product_packaging_profiles;
create trigger product_packaging_profiles_package_mm_sync
  before insert or update on public.product_packaging_profiles
  for each row execute function public.sync_packaging_profile_package_mm();

-- Derived quantities. A generated column may not reference another generated
-- column, so `packages_per_layer * layers_per_pallet` is written out in each.
alter table public.product_packaging_profiles
  add column if not exists packages_per_pallet integer
    generated always as (packages_per_layer * layers_per_pallet) stored;

alter table public.product_packaging_profiles
  add column if not exists units_per_pallet integer
    generated always as (units_per_package * packages_per_layer * layers_per_pallet) stored;

alter table public.product_packaging_profiles
  add column if not exists standard_height_mm integer
    generated always as (
      pallet_base_height_mm + layers_per_pallet * (package_height_mm + slip_sheet_height_mm)
    ) stored;

alter table public.product_packaging_profiles
  add column if not exists standard_gross_weight_kg numeric(14,2)
    generated always as (
      pallet_tare_kg + weight * (packages_per_layer * layers_per_pallet)
    ) stored;

-- One build standard per SKU. Hidden profiles are excluded so a superseded
-- revision can be archived without blocking its replacement.
create unique index if not exists product_packaging_profiles_one_standard_per_product
  on public.product_packaging_profiles (product_id)
  where is_pallet_standard and not is_hidden;

create index if not exists product_packaging_profiles_superseded_by_idx
  on public.product_packaging_profiles (superseded_by_id)
  where superseded_by_id is not null;

comment on column public.product_packaging_profiles.packages_per_layer is
  'Handling units (cases) per layer — the 6 in "6 x 8".';
comment on column public.product_packaging_profiles.layers_per_pallet is
  'Layers on a full standard pallet — the 8 in "6 x 8".';
comment on column public.product_packaging_profiles.package_height_mm is
  'Package height in millimetres. Backfilled from the legacy cm "height" column; standard_height_mm generates from this, never from "height".';
comment on column public.product_packaging_profiles.standard_height_mm is
  'Built height of a full standard pallet in millimetres, deck and slip sheets included.';

-- ── locations: one ceiling, in millimetres ───────────────────────────────────

alter table public.locations
  add column if not exists max_height_mm integer;

update public.locations
   set max_height_mm = round(max_height * 10)::int
 where max_height is not null and max_height_mm is null;

-- The Bin Locations form writes "Max height (cm)" only until Phase 2 accepts
-- inch entry, so `max_height_mm` would stay null for every bin created or
-- edited after this migration. `resolveLocationClearanceMm` takes the least
-- non-null ceiling, so a null is safe — but a stale mm value after a cm edit
-- would be wrong, in the direction of blocking a bin that actually fits. This
-- writes the legacy column through for one release, as ratified.
create or replace function public.sync_location_max_height_mm()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.max_height_mm is null
     or (tg_op = 'UPDATE'
         and new.max_height is distinct from old.max_height
         and new.max_height_mm is not distinct from old.max_height_mm) then
    new.max_height_mm := round(new.max_height * 10)::int;
  end if;
  return new;
end;
$$;

drop trigger if exists locations_max_height_mm_sync on public.locations;
create trigger locations_max_height_mm_sync
  before insert or update on public.locations
  for each row execute function public.sync_location_max_height_mm();

comment on column public.locations.max_height_mm is
  'Bin clearance in millimetres. Read through resolveLocationClearanceMm / public.location_clearance_mm, which take the least non-null of this, max_height * 10, and max_pallet_height_cm * 10.';

-- ── warehouses: the safety margin ────────────────────────────────────────────

alter table public.warehouses
  add column if not exists clearance_safety_margin_mm integer not null default 76;

comment on column public.warehouses.clearance_safety_margin_mm is
  'Headroom kept free above a stored pallet, in millimetres. Ratified default 76 mm (3 in). Must reach the fit test, the slotting filter, and the put-away block together.';

-- ── pallets: snapshot the standard the pallet was built to ───────────────────

alter table public.pallets
  add column if not exists standard_packages_per_layer integer,
  add column if not exists standard_layers_per_pallet  integer,
  add column if not exists standard_height_mm          integer;

comment on column public.pallets.standard_height_mm is
  'Built height of this pallet in millimetres, snapshotted at receipt. The height rules read this; pallets.height stays in centimetres and is kept in step with it.';

-- ── Shared clearance expressions ─────────────────────────────────────────────
-- One SQL expression, one TS helper (src/lib/measure.ts), three callers: the
-- fit test, the slotting filter, and the put-away block. If they disagree the
-- operator stops believing any of them.

create or replace function public.location_clearance_mm(
  in_max_height_mm integer,
  in_max_height numeric,
  in_max_pallet_height_cm integer
)
returns integer
language sql
immutable
as $$
  select least(
    nullif(greatest(in_max_height_mm, 0), 0),
    nullif(greatest(round(in_max_height * 10)::int, 0), 0),
    nullif(greatest(in_max_pallet_height_cm * 10, 0), 0)
  );
$$;

comment on function public.location_clearance_mm(integer, numeric, integer) is
  'Least non-null bin ceiling in millimetres across the mm column and the two legacy cm columns. Null means the bin has no recorded height restriction.';

create or replace function public.effective_clearance_mm(
  in_clearance_mm integer,
  in_margin_mm integer
)
returns integer
language sql
immutable
as $$
  select case
    when in_clearance_mm is null then null
    else greatest(in_clearance_mm - coalesce(in_margin_mm, 76), 0)
  end;
$$;

comment on function public.effective_clearance_mm(integer, integer) is
  'Bin ceiling less the warehouse safety margin — the height a pallet must fit under.';

create or replace function public.pallet_height_mm(
  in_standard_height_mm integer,
  in_height numeric
)
returns integer
language sql
immutable
as $$
  select coalesce(
    nullif(greatest(in_standard_height_mm, 0), 0),
    nullif(greatest(round(in_height * 10)::int, 0), 0)
  );
$$;

comment on function public.pallet_height_mm(integer, numeric) is
  'A pallet''s built height in millimetres: the standard snapshot, falling back to the legacy centimetre column.';