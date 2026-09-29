-- Phase 1: make the occupancy view filterable by the active warehouse.
-- The view remains security-invoker so caller RLS applies to the underlying rows.
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
  (count(ib.id) >= l.max_pallets) as is_full,
  l.warehouse_id
from public.locations l
join public.warehouses w on w.id = l.warehouse_id
join public.zones z on z.id = l.zone_id
left join public.inventory_balances ib
  on ib.location_id = l.id
 and ib.status::text not in ('picked', 'shipped', 'in_transit', 'missing')
group by l.id, l.warehouse_id, l.code, l.temperature_class, l.max_pallets, l.location_type, w.code, z.code;
