-- Location level-style support.
--
-- Locations can render their level segment either as a number (L01, L02, ...)
-- or as a letter (A, B, C, ...). The physical `level` integer is unchanged; only
-- the human/scanner code differs. Style is allowed to vary across a warehouse,
-- but must be uniform within any single zone and within any single bay.

-- 1. Style column. Existing rows use numeric codes, so default + backfill to 'numeric'.
alter table public.locations
  add column if not exists level_style text not null default 'numeric';

update public.locations
  set level_style = 'numeric'
  where level_style is null;

-- Constrain to the two supported styles.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'locations_level_style_check'
  ) then
    alter table public.locations
      add constraint locations_level_style_check
      check (level_style in ('numeric', 'alpha'));
  end if;
end
$$;

-- 2. Enforce a single level style per zone and per bay.
create or replace function public.enforce_location_level_style()
returns trigger
language plpgsql
as $$
declare
  zone_conflict integer;
  bay_conflict integer;
begin
  -- Same zone, different style.
  select count(*) into zone_conflict
  from public.locations l
  where l.zone_id = new.zone_id
    and l.id <> new.id
    and coalesce(l.level_style, 'numeric') <> coalesce(new.level_style, 'numeric');

  if zone_conflict > 0 then
    raise exception
      'Level style "%" conflicts with existing locations in this zone; a zone must use one level style.',
      new.level_style
      using errcode = '23514';
  end if;

  -- Same bay (warehouse + aisle + bay), different style.
  select count(*) into bay_conflict
  from public.locations l
  where l.warehouse_id = new.warehouse_id
    and l.aisle is not distinct from new.aisle
    and l.bay is not distinct from new.bay
    and l.id <> new.id
    and coalesce(l.level_style, 'numeric') <> coalesce(new.level_style, 'numeric');

  if bay_conflict > 0 then
    raise exception
      'Level style "%" conflicts with existing locations in this bay; a bay must use one level style.',
      new.level_style
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_location_level_style on public.locations;
create trigger trg_enforce_location_level_style
  before insert or update of level_style, zone_id, warehouse_id, aisle, bay
  on public.locations
  for each row
  execute function public.enforce_location_level_style();
