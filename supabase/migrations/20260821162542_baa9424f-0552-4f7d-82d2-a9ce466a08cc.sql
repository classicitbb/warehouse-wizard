-- Clear the stuck inventory pallet correction at J-08-C. The replacement
-- pallet PLT-260820211135943F8C7 was created and stored elsewhere, but the
-- original pallet/balance stayed in correction_state='pending' with stock at
-- J-08-C, so the bay showed 1/5 occupied with no physical pallet there.
UPDATE public.pallets
SET correction_state = 'superseded',
    quantity = 0,
    available_quantity = 0,
    current_location_id = NULL,
    is_stored = false,
    updated_at = now()
WHERE id = '73b3d839-c9c2-4bff-ba88-f5c3d8e005ae'
  AND correction_state = 'pending';

UPDATE public.inventory_balances
SET correction_state = 'superseded',
    quantity = 0,
    available_quantity = 0,
    location_id = NULL,
    zone_id = NULL,
    updated_at = now()
WHERE id = '945c76a4-a1e7-414d-8cc8-2d6da81b88d7'
  AND correction_state = 'pending';