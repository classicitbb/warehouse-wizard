-- Omit the P1 suffix for rack locations where the bay-level has only one position.
-- Multi-position bay-levels keep P1/P2/... because the position segment is needed
-- to distinguish the side-by-side slots.

with parsed as (
  select
    l.id,
    l.warehouse_id,
    l.zone_id,
    l.aisle,
    l.bay,
    l.level,
    l.position,
    l.code,
    regexp_replace(l.code, '-P0?1$', '', 'i') as base_code
  from public.locations as l
  where l.code ~* '-P0?1$'
    and coalesce(l.position, 1) = 1
),
single_position as (
  select parsed.id, parsed.base_code
  from parsed
  where not exists (
    select 1
    from public.locations as sibling
    where sibling.id <> parsed.id
      and sibling.warehouse_id = parsed.warehouse_id
      and sibling.zone_id = parsed.zone_id
      and coalesce(sibling.aisle, '') = coalesce(parsed.aisle, '')
      and coalesce(sibling.bay, '') = coalesce(parsed.bay, '')
      and coalesce(sibling.level, -1) = coalesce(parsed.level, -1)
  )
  and not exists (
    select 1
    from public.locations as existing
    where existing.id <> parsed.id
      and upper(existing.code) = upper(parsed.base_code)
  )
)
update public.locations as l
set code = single_position.base_code
from single_position
where l.id = single_position.id;
