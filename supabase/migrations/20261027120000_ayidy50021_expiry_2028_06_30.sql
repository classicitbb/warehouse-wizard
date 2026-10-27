-- One-off data fix: AYIDY50021 pallets currently stored with expiry 2026-11-26
-- actually expire on 2028-06-30. Expiry lives on both inventory_lots and the
-- denormalised inventory_balances.expiry_date, with no sync trigger, so update both.
-- Guarded on the old date so it is idempotent and never touches other lots.

update public.inventory_lots il
set expiry_date = date '2028-06-30'
from public.products p
where il.product_id = p.id
  and p.sku = 'AYIDY50021'
  and il.expiry_date = date '2026-11-26';

update public.inventory_balances ib
set expiry_date = date '2028-06-30'
from public.products p
where ib.product_id = p.id
  and p.sku = 'AYIDY50021'
  and ib.expiry_date = date '2026-11-26';
