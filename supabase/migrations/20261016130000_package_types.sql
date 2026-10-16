-- Curated package types (outbound picking design, slice A / D6).
--
-- NetSuite spells the same packaging many ways (BALE, BALES, BL; CASE, CASES,
-- CS), and product_packaging_profiles.package_type has been free text (Bale,
-- Box, case). package_types is the one master list; `aliases` holds every
-- known spelling in lower case, and resolve_package_type_id() maps any of them
-- (or the code itself) to a row.
--
-- Additive only. product_packaging_profiles.package_type stays in place; a
-- trigger keeps it and the new package_type_id in step, so writers that still
-- send text (the Pack Pak Designer, pack-standard capture, CSV imports) set the
-- FK too, and writers that send the FK keep the legacy text readable.

create table if not exists public.package_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  aliases     text[] not null default '{}',
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint package_types_code_upper check (code = upper(code))
);

drop trigger if exists set_package_types_updated_at on public.package_types;
create trigger set_package_types_updated_at
  before update on public.package_types
  for each row execute function public.set_updated_at();

-- Aliases are taken from the distinct unitstypeuom unitname/abbreviation values
-- in the Simplex sandbox (9738806-sb1, 2026-10-16) plus the spellings already in
-- product_packaging_profiles. Single-sell units with no carton of their own
-- (bottle, can, set, pair, ring) count as EACH.
insert into public.package_types (code, name, aliases, sort) values
  ('BALE',   'Bale',   array['bale', 'bales', 'bl'], 10),
  ('CASE',   'Case',   array['case', 'cases', 'cs', 'carton', 'cartons', 'ctn'], 20),
  ('BAG',    'Bag',    array['bag', 'bags', 'bg', 'bas'], 30),
  ('PACK',   'Pack',   array['pack', 'packs', 'pk', 'pkg'], 40),
  ('BOX',    'Box',    array['box', 'boxes', 'bx', 'bxs'], 50),
  ('ROLL',   'Roll',   array['roll', 'rolls', 'rl'], 60),
  ('EACH',   'Each',   array['each', 'ea', 'unit', 'units', 'piece', 'pc', 'btl', 'bottle', 'can', 'set', 'pair', 'pr', 'ring', 'rg'], 70),
  ('TOTE',   'Tote',   array['tote', 'totes'], 80),
  ('WEIGHT', 'Weight', array['weight', 'kg', 'lb', 'lbs'], 90)
on conflict (code) do nothing;

alter table public.package_types enable row level security;

drop policy if exists "Approved users can read package_types" on public.package_types;
create policy "Approved users can read package_types" on public.package_types
  for select to authenticated using (public.is_approved());

drop policy if exists "Managers write package_types" on public.package_types;
create policy "Managers write package_types" on public.package_types
  for insert to authenticated
  with check (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager'));

drop policy if exists "Managers update package_types" on public.package_types;
create policy "Managers update package_types" on public.package_types
  for update to authenticated
  using (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager'))
  with check (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager'));

drop policy if exists "Managers delete package_types" on public.package_types;
create policy "Managers delete package_types" on public.package_types
  for delete to authenticated
  using (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager'));

-- Any spelling (code or alias, any case, surrounding spaces ignored) -> id.
create or replace function public.resolve_package_type_id(p_text text)
returns uuid
language sql
stable
set search_path = public
as $$
  select pt.id
  from public.package_types pt
  where nullif(btrim(p_text), '') is not null
    and (
      pt.code = upper(btrim(p_text))
      or exists (select 1 from unnest(pt.aliases) a where lower(a) = lower(btrim(p_text)))
    )
  order by pt.sort, pt.code
  limit 1;
$$;

grant execute on function public.resolve_package_type_id(text) to authenticated, service_role;

-- ============================================================
-- product_packaging_profiles.package_type_id
-- ============================================================
alter table public.product_packaging_profiles
  add column if not exists package_type_id uuid references public.package_types (id) on delete set null;

create index if not exists idx_product_packaging_profiles_package_type
  on public.product_packaging_profiles (package_type_id);

comment on column public.product_packaging_profiles.package_type is
  'Legacy free text. Kept in step with package_type_id by sync_packaging_profile_package_type(); read package_type_id instead.';

-- The FK wins when it changes; otherwise a changed text value is resolved.
-- Text that matches nothing (e.g. "pallet") leaves the FK null. Text that
-- already names the chosen type (e.g. "Bale" for BALE) is left as written.
create or replace function public.sync_packaging_profile_package_type()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  type_changed boolean := tg_op = 'INSERT' or new.package_type_id is distinct from old.package_type_id;
  text_changed boolean := tg_op = 'INSERT' or new.package_type is distinct from old.package_type;
begin
  if new.package_type_id is not null and type_changed then
    if public.resolve_package_type_id(new.package_type) is distinct from new.package_type_id then
      select lower(pt.code) into new.package_type from public.package_types pt where pt.id = new.package_type_id;
    end if;
  elsif text_changed and (tg_op = 'INSERT' or not type_changed) then
    new.package_type_id := public.resolve_package_type_id(new.package_type);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_packaging_profile_package_type on public.product_packaging_profiles;
create trigger sync_packaging_profile_package_type
  before insert or update of package_type, package_type_id on public.product_packaging_profiles
  for each row execute function public.sync_packaging_profile_package_type();

-- Backfill from the current free text (Bale, Box, case, ...).
update public.product_packaging_profiles p
set package_type_id = public.resolve_package_type_id(p.package_type)
where p.package_type_id is null
  and public.resolve_package_type_id(p.package_type) is not null;
