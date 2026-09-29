-- Normalize rack location scan codes to rack-bay-level-position only.
-- Warehouse, zone, and aisle remain stored on their dedicated columns.
with parsed as (
  select
    id,
    code,
    regexp_split_to_array(upper(code), '-') as parts
  from public.locations
  where location_type = 'rack'
    and code is not null
),
legacy as (
  select
    id,
    code,
    parts,
    array_length(parts, 1) as part_count
  from parsed
  where array_length(parts, 1) >= 5
    and parts[array_length(parts, 1) - 1] ~ '^L[0-9]+$'
    and parts[array_length(parts, 1)] ~ '^P[0-9]+$'
)
update public.locations as locations
set code = concat(
  legacy.parts[legacy.part_count - 4],
  '-',
  lpad(legacy.parts[legacy.part_count - 2], 2, '0'),
  '-L',
  lpad(regexp_replace(legacy.parts[legacy.part_count - 1], '^L', ''), 2, '0'),
  '-P',
  regexp_replace(legacy.parts[legacy.part_count], '^P', '')
)
from legacy
where locations.id = legacy.id
  and locations.code <> concat(
    legacy.parts[legacy.part_count - 4],
    '-',
    lpad(legacy.parts[legacy.part_count - 2], 2, '0'),
    '-L',
    lpad(regexp_replace(legacy.parts[legacy.part_count - 1], '^L', ''), 2, '0'),
    '-P',
    regexp_replace(legacy.parts[legacy.part_count], '^P', '')
  );
