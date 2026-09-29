insert into public.receipts (
  receipt_number,
  receipt_type,
  reference_number,
  container_number,
  po_number,
  draft_group_id,
  draft_pallet_barcode,
  draft_sequence,
  draft_count,
  warehouse_id,
  client_id,
  status,
  notes
)
select
  format('RCT-DRAFT-%s-%s', w.code, seq.n),
  'po'::public.receipt_type,
  format('DEMO-PO-%s', w.code),
  format('DEMO-CONT-%s', w.code),
  format('DEMO-PO-%s', w.code),
  draft_group.id,
  format('PLT-DRAFT-%s-%s', w.code, seq.n),
  seq.n,
  2,
  w.id,
  coalesce(p.client_id, c.id),
  'draft'::public.task_status,
  jsonb_build_object(
    '_draft', true,
    '_shipment', true,
    '_seeded_draft', true,
    'draft_pallet_barcode', format('PLT-DRAFT-%s-%s', w.code, seq.n),
    'draft_group_id', draft_group.id,
    'draft_sequence', seq.n,
    'draft_count', 2,
    'container_number', format('DEMO-CONT-%s', w.code),
    'po_number', format('DEMO-PO-%s', w.code),
    'product_id', p.id,
    'quantity', case when seq.n = 1 then 24 else 18 end,
    'total_quantity', 42,
    'quantity_per_pallet', case when seq.n = 1 then 24 else 18 end,
    'remainder_quantity', 0,
    'expiry_date', case when p.expiry_tracked then (current_date + interval '90 days')::date else null end,
    'lot_number', format('DRAFT-%s', w.code),
    'batch_number', format('BATCH-%s', w.code),
    'packaging_profile_id', ppf.id
  )::text
from public.warehouses w
cross join lateral (select gen_random_uuid() as id) draft_group
cross join (values (1), (2)) as seq(n)
cross join lateral (
  select p.*
  from public.products p
  where p.active = true
  order by p.created_at, p.sku
  limit 1
) p
left join lateral (
  select ppf.id
  from public.product_packaging_profiles ppf
  where ppf.product_id = p.id
  order by ppf.created_at
  limit 1
) ppf on true
left join lateral (
  select c.id
  from public.clients c
  where c.active = true
  order by c.created_at, c.code
  limit 1
) c on true
where w.active = true
  and not exists (
    select 1
    from public.receipts r
    where r.warehouse_id = w.id
      and r.status = 'draft'::public.task_status
  );
