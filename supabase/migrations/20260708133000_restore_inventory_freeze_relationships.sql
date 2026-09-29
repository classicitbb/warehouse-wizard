-- Restore foreign key metadata for deployments where inventory_freezes already
-- existed before the live-safe foundation migration ran. In that case,
-- CREATE TABLE IF NOT EXISTS does not add inline constraints, which leaves
-- PostgREST unable to embed cycle_counts <-> inventory_freezes.

do $$
begin
  if to_regclass('public.inventory_freezes') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'inventory_freezes'
        and column_name = 'cycle_count_id'
    )
    and not exists (
      select 1
      from pg_constraint
      where conname = 'inventory_freezes_cycle_count_id_fkey'
        and conrelid = 'public.inventory_freezes'::regclass
    )
  then
    alter table public.inventory_freezes
      add constraint inventory_freezes_cycle_count_id_fkey
      foreign key (cycle_count_id) references public.cycle_counts(id) on delete cascade
      not valid;
  end if;
end $$;

do $$
begin
  if to_regclass('public.inventory_freezes') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'inventory_freezes'
        and column_name = 'warehouse_id'
    )
    and not exists (
      select 1
      from pg_constraint
      where conname = 'inventory_freezes_warehouse_id_fkey'
        and conrelid = 'public.inventory_freezes'::regclass
    )
  then
    alter table public.inventory_freezes
      add constraint inventory_freezes_warehouse_id_fkey
      foreign key (warehouse_id) references public.warehouses(id)
      not valid;
  end if;
end $$;

do $$
begin
  if to_regclass('public.inventory_freezes') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'inventory_freezes'
        and column_name = 'location_id'
    )
    and not exists (
      select 1
      from pg_constraint
      where conname = 'inventory_freezes_location_id_fkey'
        and conrelid = 'public.inventory_freezes'::regclass
    )
  then
    alter table public.inventory_freezes
      add constraint inventory_freezes_location_id_fkey
      foreign key (location_id) references public.locations(id)
      not valid;
  end if;
end $$;

do $$
begin
  if to_regclass('public.inventory_freezes') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'inventory_freezes'
        and column_name = 'pallet_id'
    )
    and not exists (
      select 1
      from pg_constraint
      where conname = 'inventory_freezes_pallet_id_fkey'
        and conrelid = 'public.inventory_freezes'::regclass
    )
  then
    alter table public.inventory_freezes
      add constraint inventory_freezes_pallet_id_fkey
      foreign key (pallet_id) references public.pallets(id)
      not valid;
  end if;
end $$;

do $$
begin
  if to_regclass('public.inventory_freezes') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'inventory_freezes'
        and column_name = 'created_by'
    )
    and not exists (
      select 1
      from pg_constraint
      where conname = 'inventory_freezes_created_by_fkey'
        and conrelid = 'public.inventory_freezes'::regclass
    )
  then
    alter table public.inventory_freezes
      add constraint inventory_freezes_created_by_fkey
      foreign key (created_by) references auth.users(id)
      not valid;
  end if;
end $$;

do $$
begin
  if to_regclass('public.inventory_freezes') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'inventory_freezes'
        and column_name = 'released_by'
    )
    and not exists (
      select 1
      from pg_constraint
      where conname = 'inventory_freezes_released_by_fkey'
        and conrelid = 'public.inventory_freezes'::regclass
    )
  then
    alter table public.inventory_freezes
      add constraint inventory_freezes_released_by_fkey
      foreign key (released_by) references auth.users(id)
      not valid;
  end if;
end $$;

notify pgrst, 'reload schema';
