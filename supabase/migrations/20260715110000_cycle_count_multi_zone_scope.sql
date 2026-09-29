alter table public.cycle_counts
  add column if not exists zone_ids uuid[];

update public.cycle_counts
set zone_ids = array[zone_id]
where zone_id is not null
  and (zone_ids is null or cardinality(zone_ids) = 0);

create index if not exists idx_cycle_counts_zone_ids
  on public.cycle_counts using gin (zone_ids);
