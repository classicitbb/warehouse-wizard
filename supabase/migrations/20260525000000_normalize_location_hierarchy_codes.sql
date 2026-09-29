-- Normalize existing location codes to include the full warehouse-zone-location hierarchy.
-- Example: A-01-L01 -> NEW-WLD-A-01-L01.
update public.locations as l
set code = concat_ws('-', w.code, z.code, l.code),
    updated_at = now()
from public.warehouses as w,
     public.zones as z
where l.warehouse_id = w.id
  and l.zone_id = z.id
  and w.code is not null
  and z.code is not null
  and l.code is not null
  and l.code <> ''
  and l.code not ilike concat(w.code, '-', z.code, '-%')
  and not exists (
    select 1
    from public.locations as existing
    where existing.id <> l.id
      and existing.code = concat_ws('-', w.code, z.code, l.code)
  );
