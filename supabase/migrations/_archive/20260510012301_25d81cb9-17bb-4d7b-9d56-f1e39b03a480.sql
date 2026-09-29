-- Fix: Prevent users from self-approving via profile update
CREATE OR REPLACE FUNCTION public.prevent_self_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.approved IS DISTINCT FROM OLD.approved
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
       JOIN public.roles r ON r.id = ur.role_id
       WHERE ur.user_id = auth.uid() AND r.code = 'admin'
     )
  THEN
    RAISE EXCEPTION 'Only admins can change the approved status';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_approval ON public.profiles;
CREATE TRIGGER trg_prevent_self_approval
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_approval();

-- Fix: Recreate views with SECURITY INVOKER so they respect querying user's RLS
CREATE OR REPLACE VIEW public.inventory_search_view
WITH (security_invoker = true) AS
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
   pr.rotation_method
  FROM inventory_balances ib
    JOIN pallets p ON p.id = ib.pallet_id
    JOIN products pr ON pr.id = ib.product_id
    LEFT JOIN clients c ON c.id = ib.client_id
    LEFT JOIN inventory_lots il ON il.id = ib.inventory_lot_id
    JOIN warehouses w ON w.id = ib.warehouse_id
    LEFT JOIN zones z ON z.id = ib.zone_id
    LEFT JOIN locations l ON l.id = ib.location_id;

CREATE OR REPLACE VIEW public.location_occupancy_view
WITH (security_invoker = true) AS
SELECT l.id AS location_id,
   l.code AS location_code,
   l.temperature_class,
   l.max_pallets,
   l.location_type,
   w.code AS warehouse_code,
   z.code AS zone_code,
   (count(ib.id))::integer AS occupied_pallets,
   (count(ib.id) >= l.max_pallets) AS is_full
  FROM locations l
    JOIN warehouses w ON w.id = l.warehouse_id
    JOIN zones z ON z.id = l.zone_id
    LEFT JOIN inventory_balances ib ON ib.location_id = l.id
  GROUP BY l.id, l.code, l.temperature_class, l.max_pallets, l.location_type, w.code, z.code;