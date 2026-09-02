create or replace function public.product_quantity_totals()
returns table (product_id uuid, total_quantity numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select ib.product_id, sum(coalesce(ib.available_quantity, ib.quantity, 0))::numeric
  from public.inventory_balances ib
  where ib.status = 'available'
    and ib.location_id is not null
    and coalesce(ib.available_quantity, 0) > 0
  group by ib.product_id
$$;

revoke all on function public.product_quantity_totals() from public, anon;
grant execute on function public.product_quantity_totals() to authenticated;

create index if not exists idx_pallets_location_status on public.pallets (current_location_id, status);
create index if not exists idx_locations_hidden_zone on public.locations (is_hidden, zone_id);
create index if not exists idx_locations_hidden_warehouse on public.locations (is_hidden, warehouse_id);