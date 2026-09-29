CREATE OR REPLACE VIEW public.inventory_search_view AS
SELECT ib.id AS inventory_balance_id,
    p.pallet_code,
    p.pallet_barcode,
    pr.sku,
    pr.name AS product_name,
    pr.barcode AS product_barcode,
    c.code AS client_code,
    c.name AS client_name,
    il.lot_number,
    il.batch_number,
    il.expiry_date,
    il.manufacture_date,
    w.code AS warehouse_code,
    w.name AS warehouse_name,
    z.code AS zone_code,
    z.name AS zone_name,
    l.code AS location_code,
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
    pr.rotation_method,
    ib.warehouse_id,
    ib.zone_id,
    ib.location_id,
    ib.product_id,
    ib.client_id,
    ib.pallet_id,
    ib.inventory_lot_id,
    NULL::text AS container_number,
    c.name AS owner_name,
    ib.created_at,
    r.reference_number AS po_number
   FROM public.inventory_balances ib
     JOIN public.pallets p ON p.id = ib.pallet_id
     JOIN public.products pr ON pr.id = ib.product_id
     LEFT JOIN public.clients c ON c.id = ib.client_id
     LEFT JOIN public.inventory_lots il ON il.id = ib.inventory_lot_id
     JOIN public.warehouses w ON w.id = ib.warehouse_id
     LEFT JOIN public.zones z ON z.id = ib.zone_id
     LEFT JOIN public.locations l ON l.id = ib.location_id
     LEFT JOIN public.receipt_lines rl ON rl.id = p.receipt_line_id
     LEFT JOIN public.receipts r ON r.id = rl.receipt_id;

GRANT SELECT ON public.inventory_search_view TO authenticated;
GRANT ALL ON public.inventory_search_view TO service_role;