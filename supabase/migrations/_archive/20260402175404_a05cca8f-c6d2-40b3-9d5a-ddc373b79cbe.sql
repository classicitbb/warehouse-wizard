
-- 1. Create SECURITY DEFINER helper: has_role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = _user_id
      AND r.code = _role
  );
$$;

-- 2. Create SECURITY DEFINER helper: is_approved
CREATE OR REPLACE FUNCTION public.is_approved()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT approved FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

-- ===== Fix user_roles policies =====

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Authenticated can read user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete user_roles" ON public.user_roles;

-- Users can read their own roles; admins can read all
CREATE POLICY "Users read own or admin reads all user_roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
  );

-- Only admins can insert user_roles (using safe function)
CREATE POLICY "Admins can insert user_roles"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Only admins can delete user_roles (using safe function)
CREATE POLICY "Admins can delete user_roles"
  ON public.user_roles FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ===== Enforce is_approved() on all WMS operational tables =====

-- pallets
DROP POLICY IF EXISTS "Authenticated users can read pallets" ON public.pallets;
CREATE POLICY "Approved users can read pallets" ON public.pallets FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert pallets" ON public.pallets;
CREATE POLICY "Approved users can insert pallets" ON public.pallets FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update pallets" ON public.pallets;
CREATE POLICY "Approved users can update pallets" ON public.pallets FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete pallets" ON public.pallets;
CREATE POLICY "Approved users can delete pallets" ON public.pallets FOR DELETE TO authenticated USING (public.is_approved());

-- locations
DROP POLICY IF EXISTS "Authenticated users can read locations" ON public.locations;
CREATE POLICY "Approved users can read locations" ON public.locations FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert locations" ON public.locations;
CREATE POLICY "Approved users can insert locations" ON public.locations FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update locations" ON public.locations;
CREATE POLICY "Approved users can update locations" ON public.locations FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete locations" ON public.locations;
CREATE POLICY "Approved users can delete locations" ON public.locations FOR DELETE TO authenticated USING (public.is_approved());

-- inventory_balances
DROP POLICY IF EXISTS "Authenticated users can read inventory_balances" ON public.inventory_balances;
CREATE POLICY "Approved users can read inventory_balances" ON public.inventory_balances FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert inventory_balances" ON public.inventory_balances;
CREATE POLICY "Approved users can insert inventory_balances" ON public.inventory_balances FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update inventory_balances" ON public.inventory_balances;
CREATE POLICY "Approved users can update inventory_balances" ON public.inventory_balances FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete inventory_balances" ON public.inventory_balances;
CREATE POLICY "Approved users can delete inventory_balances" ON public.inventory_balances FOR DELETE TO authenticated USING (public.is_approved());

-- products
DROP POLICY IF EXISTS "Authenticated users can read products" ON public.products;
CREATE POLICY "Approved users can read products" ON public.products FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert products" ON public.products;
CREATE POLICY "Approved users can insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update products" ON public.products;
CREATE POLICY "Approved users can update products" ON public.products FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete products" ON public.products;
CREATE POLICY "Approved users can delete products" ON public.products FOR DELETE TO authenticated USING (public.is_approved());

-- orders
DROP POLICY IF EXISTS "Authenticated users can read orders" ON public.orders;
CREATE POLICY "Approved users can read orders" ON public.orders FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert orders" ON public.orders;
CREATE POLICY "Approved users can insert orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update orders" ON public.orders;
CREATE POLICY "Approved users can update orders" ON public.orders FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete orders" ON public.orders;
CREATE POLICY "Approved users can delete orders" ON public.orders FOR DELETE TO authenticated USING (public.is_approved());

-- order_lines
DROP POLICY IF EXISTS "Authenticated users can read order_lines" ON public.order_lines;
CREATE POLICY "Approved users can read order_lines" ON public.order_lines FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert order_lines" ON public.order_lines;
CREATE POLICY "Approved users can insert order_lines" ON public.order_lines FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update order_lines" ON public.order_lines;
CREATE POLICY "Approved users can update order_lines" ON public.order_lines FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete order_lines" ON public.order_lines;
CREATE POLICY "Approved users can delete order_lines" ON public.order_lines FOR DELETE TO authenticated USING (public.is_approved());

-- receipts
DROP POLICY IF EXISTS "Authenticated users can read receipts" ON public.receipts;
CREATE POLICY "Approved users can read receipts" ON public.receipts FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert receipts" ON public.receipts;
CREATE POLICY "Approved users can insert receipts" ON public.receipts FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update receipts" ON public.receipts;
CREATE POLICY "Approved users can update receipts" ON public.receipts FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete receipts" ON public.receipts;
CREATE POLICY "Approved users can delete receipts" ON public.receipts FOR DELETE TO authenticated USING (public.is_approved());

-- receipt_lines
DROP POLICY IF EXISTS "Authenticated users can read receipt_lines" ON public.receipt_lines;
CREATE POLICY "Approved users can read receipt_lines" ON public.receipt_lines FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert receipt_lines" ON public.receipt_lines;
CREATE POLICY "Approved users can insert receipt_lines" ON public.receipt_lines FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update receipt_lines" ON public.receipt_lines;
CREATE POLICY "Approved users can update receipt_lines" ON public.receipt_lines FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete receipt_lines" ON public.receipt_lines;
CREATE POLICY "Approved users can delete receipt_lines" ON public.receipt_lines FOR DELETE TO authenticated USING (public.is_approved());

-- warehouses
DROP POLICY IF EXISTS "Authenticated users can read warehouses" ON public.warehouses;
CREATE POLICY "Approved users can read warehouses" ON public.warehouses FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert warehouses" ON public.warehouses;
CREATE POLICY "Approved users can insert warehouses" ON public.warehouses FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update warehouses" ON public.warehouses;
CREATE POLICY "Approved users can update warehouses" ON public.warehouses FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete warehouses" ON public.warehouses;
CREATE POLICY "Approved users can delete warehouses" ON public.warehouses FOR DELETE TO authenticated USING (public.is_approved());

-- zones
DROP POLICY IF EXISTS "Authenticated users can read zones" ON public.zones;
CREATE POLICY "Approved users can read zones" ON public.zones FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert zones" ON public.zones;
CREATE POLICY "Approved users can insert zones" ON public.zones FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update zones" ON public.zones;
CREATE POLICY "Approved users can update zones" ON public.zones FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete zones" ON public.zones;
CREATE POLICY "Approved users can delete zones" ON public.zones FOR DELETE TO authenticated USING (public.is_approved());

-- transfers
DROP POLICY IF EXISTS "Authenticated users can read transfers" ON public.transfers;
CREATE POLICY "Approved users can read transfers" ON public.transfers FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert transfers" ON public.transfers;
CREATE POLICY "Approved users can insert transfers" ON public.transfers FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update transfers" ON public.transfers;
CREATE POLICY "Approved users can update transfers" ON public.transfers FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete transfers" ON public.transfers;
CREATE POLICY "Approved users can delete transfers" ON public.transfers FOR DELETE TO authenticated USING (public.is_approved());

-- transfer_lines
DROP POLICY IF EXISTS "Authenticated users can read transfer_lines" ON public.transfer_lines;
CREATE POLICY "Approved users can read transfer_lines" ON public.transfer_lines FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert transfer_lines" ON public.transfer_lines;
CREATE POLICY "Approved users can insert transfer_lines" ON public.transfer_lines FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update transfer_lines" ON public.transfer_lines;
CREATE POLICY "Approved users can update transfer_lines" ON public.transfer_lines FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete transfer_lines" ON public.transfer_lines;
CREATE POLICY "Approved users can delete transfer_lines" ON public.transfer_lines FOR DELETE TO authenticated USING (public.is_approved());

-- pick_lists
DROP POLICY IF EXISTS "Authenticated users can read pick_lists" ON public.pick_lists;
CREATE POLICY "Approved users can read pick_lists" ON public.pick_lists FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert pick_lists" ON public.pick_lists;
CREATE POLICY "Approved users can insert pick_lists" ON public.pick_lists FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update pick_lists" ON public.pick_lists;
CREATE POLICY "Approved users can update pick_lists" ON public.pick_lists FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete pick_lists" ON public.pick_lists;
CREATE POLICY "Approved users can delete pick_lists" ON public.pick_lists FOR DELETE TO authenticated USING (public.is_approved());

-- pick_tasks
DROP POLICY IF EXISTS "Authenticated users can read pick_tasks" ON public.pick_tasks;
CREATE POLICY "Approved users can read pick_tasks" ON public.pick_tasks FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert pick_tasks" ON public.pick_tasks;
CREATE POLICY "Approved users can insert pick_tasks" ON public.pick_tasks FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update pick_tasks" ON public.pick_tasks;
CREATE POLICY "Approved users can update pick_tasks" ON public.pick_tasks FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete pick_tasks" ON public.pick_tasks;
CREATE POLICY "Approved users can delete pick_tasks" ON public.pick_tasks FOR DELETE TO authenticated USING (public.is_approved());

-- move_tasks
DROP POLICY IF EXISTS "Authenticated users can read move_tasks" ON public.move_tasks;
CREATE POLICY "Approved users can read move_tasks" ON public.move_tasks FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert move_tasks" ON public.move_tasks;
CREATE POLICY "Approved users can insert move_tasks" ON public.move_tasks FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update move_tasks" ON public.move_tasks;
CREATE POLICY "Approved users can update move_tasks" ON public.move_tasks FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete move_tasks" ON public.move_tasks;
CREATE POLICY "Approved users can delete move_tasks" ON public.move_tasks FOR DELETE TO authenticated USING (public.is_approved());

-- putaway_tasks
DROP POLICY IF EXISTS "Authenticated users can read putaway_tasks" ON public.putaway_tasks;
CREATE POLICY "Approved users can read putaway_tasks" ON public.putaway_tasks FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert putaway_tasks" ON public.putaway_tasks;
CREATE POLICY "Approved users can insert putaway_tasks" ON public.putaway_tasks FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update putaway_tasks" ON public.putaway_tasks;
CREATE POLICY "Approved users can update putaway_tasks" ON public.putaway_tasks FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete putaway_tasks" ON public.putaway_tasks;
CREATE POLICY "Approved users can delete putaway_tasks" ON public.putaway_tasks FOR DELETE TO authenticated USING (public.is_approved());

-- cycle_counts
DROP POLICY IF EXISTS "Authenticated users can read cycle_counts" ON public.cycle_counts;
CREATE POLICY "Approved users can read cycle_counts" ON public.cycle_counts FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert cycle_counts" ON public.cycle_counts;
CREATE POLICY "Approved users can insert cycle_counts" ON public.cycle_counts FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update cycle_counts" ON public.cycle_counts;
CREATE POLICY "Approved users can update cycle_counts" ON public.cycle_counts FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete cycle_counts" ON public.cycle_counts;
CREATE POLICY "Approved users can delete cycle_counts" ON public.cycle_counts FOR DELETE TO authenticated USING (public.is_approved());

-- cycle_count_lines
DROP POLICY IF EXISTS "Authenticated users can read cycle_count_lines" ON public.cycle_count_lines;
CREATE POLICY "Approved users can read cycle_count_lines" ON public.cycle_count_lines FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert cycle_count_lines" ON public.cycle_count_lines;
CREATE POLICY "Approved users can insert cycle_count_lines" ON public.cycle_count_lines FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update cycle_count_lines" ON public.cycle_count_lines;
CREATE POLICY "Approved users can update cycle_count_lines" ON public.cycle_count_lines FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete cycle_count_lines" ON public.cycle_count_lines;
CREATE POLICY "Approved users can delete cycle_count_lines" ON public.cycle_count_lines FOR DELETE TO authenticated USING (public.is_approved());

-- inventory_lots
DROP POLICY IF EXISTS "Authenticated users can read inventory_lots" ON public.inventory_lots;
CREATE POLICY "Approved users can read inventory_lots" ON public.inventory_lots FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert inventory_lots" ON public.inventory_lots;
CREATE POLICY "Approved users can insert inventory_lots" ON public.inventory_lots FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update inventory_lots" ON public.inventory_lots;
CREATE POLICY "Approved users can update inventory_lots" ON public.inventory_lots FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete inventory_lots" ON public.inventory_lots;
CREATE POLICY "Approved users can delete inventory_lots" ON public.inventory_lots FOR DELETE TO authenticated USING (public.is_approved());

-- stock_adjustments
DROP POLICY IF EXISTS "Authenticated users can read stock_adjustments" ON public.stock_adjustments;
CREATE POLICY "Approved users can read stock_adjustments" ON public.stock_adjustments FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert stock_adjustments" ON public.stock_adjustments;
CREATE POLICY "Approved users can insert stock_adjustments" ON public.stock_adjustments FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update stock_adjustments" ON public.stock_adjustments;
CREATE POLICY "Approved users can update stock_adjustments" ON public.stock_adjustments FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete stock_adjustments" ON public.stock_adjustments;
CREATE POLICY "Approved users can delete stock_adjustments" ON public.stock_adjustments FOR DELETE TO authenticated USING (public.is_approved());

-- barcode_labels
DROP POLICY IF EXISTS "Authenticated users can read barcode_labels" ON public.barcode_labels;
CREATE POLICY "Approved users can read barcode_labels" ON public.barcode_labels FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert barcode_labels" ON public.barcode_labels;
CREATE POLICY "Approved users can insert barcode_labels" ON public.barcode_labels FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update barcode_labels" ON public.barcode_labels;
CREATE POLICY "Approved users can update barcode_labels" ON public.barcode_labels FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete barcode_labels" ON public.barcode_labels;
CREATE POLICY "Approved users can delete barcode_labels" ON public.barcode_labels FOR DELETE TO authenticated USING (public.is_approved());

-- clients
DROP POLICY IF EXISTS "Authenticated users can read clients" ON public.clients;
CREATE POLICY "Approved users can read clients" ON public.clients FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert clients" ON public.clients;
CREATE POLICY "Approved users can insert clients" ON public.clients FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update clients" ON public.clients;
CREATE POLICY "Approved users can update clients" ON public.clients FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete clients" ON public.clients;
CREATE POLICY "Approved users can delete clients" ON public.clients FOR DELETE TO authenticated USING (public.is_approved());

-- product_packaging_profiles
DROP POLICY IF EXISTS "Authenticated users can read product_packaging_profiles" ON public.product_packaging_profiles;
CREATE POLICY "Approved users can read product_packaging_profiles" ON public.product_packaging_profiles FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert product_packaging_profiles" ON public.product_packaging_profiles;
CREATE POLICY "Approved users can insert product_packaging_profiles" ON public.product_packaging_profiles FOR INSERT TO authenticated WITH CHECK (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can update product_packaging_profiles" ON public.product_packaging_profiles;
CREATE POLICY "Approved users can update product_packaging_profiles" ON public.product_packaging_profiles FOR UPDATE TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can delete product_packaging_profiles" ON public.product_packaging_profiles;
CREATE POLICY "Approved users can delete product_packaging_profiles" ON public.product_packaging_profiles FOR DELETE TO authenticated USING (public.is_approved());

-- audit_events (keep insert/select only, add approval check)
DROP POLICY IF EXISTS "Authenticated users can read audit_events" ON public.audit_events;
CREATE POLICY "Approved users can read audit_events" ON public.audit_events FOR SELECT TO authenticated USING (public.is_approved());
DROP POLICY IF EXISTS "Authenticated users can insert audit_events" ON public.audit_events;
CREATE POLICY "Approved users can insert audit_events" ON public.audit_events FOR INSERT TO authenticated WITH CHECK (public.is_approved());
