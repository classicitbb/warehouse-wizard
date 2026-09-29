alter table public.receipts
  add column if not exists container_number text,
  add column if not exists po_number text,
  add column if not exists draft_group_id uuid,
  add column if not exists draft_pallet_barcode text,
  add column if not exists draft_sequence integer,
  add column if not exists draft_count integer;

create index if not exists receipts_container_number_idx on public.receipts (container_number);
create index if not exists receipts_po_number_idx on public.receipts (po_number);
create index if not exists receipts_draft_group_id_idx on public.receipts (draft_group_id);

drop view if exists public.inventory_search_view;
create view public.inventory_search_view
with (security_invoker = true) as
select
  ib.id as inventory_balance_id,
  ib.warehouse_id,
  ib.product_id,
  ib.client_id,
  ib.location_id,
  p.id as pallet_id,
  p.pallet_code,
  p.pallet_barcode,
  r.container_number,
  r.po_number,
  pr.sku,
  pr.name as product_name,
  pr.barcode as product_barcode,
  c.code as client_code,
  c.name as client_name,
  il.lot_number,
  il.batch_number,
  il.expiry_date,
  il.manufacture_date,
  w.code as warehouse_code,
  w.name as warehouse_name,
  z.code as zone_code,
  z.name as zone_name,
  l.code as location_code,
  ib.status,
  ib.quantity,
  ib.available_quantity,
  ib.reserved_quantity,
  ib.held_quantity,
  ib.damaged_quantity,
  ib.received_at,
  p.length,
  p.width,
  p.height,
  p.weight,
  pr.temperature_requirement,
  pr.product_family,
  pr.rotation_method
from public.inventory_balances ib
join public.pallets p on p.id = ib.pallet_id
join public.products pr on pr.id = ib.product_id
left join public.receipt_lines rl on rl.id = p.receipt_line_id
left join public.receipts r on r.id = rl.receipt_id
left join public.clients c on c.id = ib.client_id
left join public.inventory_lots il on il.id = ib.inventory_lot_id
join public.warehouses w on w.id = ib.warehouse_id
left join public.zones z on z.id = ib.zone_id
left join public.locations l on l.id = ib.location_id;

grant select on public.inventory_search_view to authenticated;
grant select on public.inventory_search_view to service_role;