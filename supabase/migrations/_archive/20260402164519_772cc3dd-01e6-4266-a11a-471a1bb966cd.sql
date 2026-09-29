
-- ============================================================
-- ENUMS
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.temperature_class AS ENUM ('ambient','cool','frozen');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.inventory_status AS ENUM ('receiving','available','reserved','hold','quarantine','damaged','missing','in_transit','shipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.task_status AS ENUM ('draft','queued','assigned','in_progress','completed','cancelled','exception');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.location_type AS ENUM ('rack','staging','dispatch','quarantine','floor','dock','other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.receipt_type AS ENUM ('po','transfer','return','other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.rotation_method AS ENUM ('fifo','fefo','lifo');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.count_scope AS ENUM ('location','zone','sku','spot');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- ALTER existing tables
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_warehouse_id uuid;

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS warehouse_id uuid;

-- ============================================================
-- WAREHOUSES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  address_line_1 text,
  address_line_2 text,
  city text,
  country text DEFAULT 'Barbados',
  has_cool_zone boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read warehouses" ON public.warehouses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert warehouses" ON public.warehouses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update warehouses" ON public.warehouses FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete warehouses" ON public.warehouses FOR DELETE TO authenticated USING (true);

-- FK from profiles
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_default_warehouse_id_fkey
  FOREIGN KEY (default_warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;

-- ============================================================
-- ZONES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  temperature_class public.temperature_class NOT NULL DEFAULT 'ambient',
  is_dispatch boolean NOT NULL DEFAULT false,
  is_quarantine boolean NOT NULL DEFAULT false,
  is_staging boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(warehouse_id, code)
);
ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read zones" ON public.zones FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert zones" ON public.zones FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update zones" ON public.zones FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete zones" ON public.zones FOR DELETE TO authenticated USING (true);

-- ============================================================
-- LOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  aisle text,
  bay text,
  level integer DEFAULT 1,
  depth integer DEFAULT 1,
  location_type public.location_type NOT NULL DEFAULT 'rack',
  temperature_class public.temperature_class NOT NULL DEFAULT 'ambient',
  max_length numeric(10,2) DEFAULT 120,
  max_width numeric(10,2) DEFAULT 100,
  max_height numeric(10,2) DEFAULT 190,
  max_weight numeric(12,2) DEFAULT 1250,
  max_pallets integer NOT NULL DEFAULT 1,
  mixed_sku_allowed boolean NOT NULL DEFAULT false,
  mixed_lot_allowed boolean NOT NULL DEFAULT false,
  allowed_product_family text,
  pick_sequence integer DEFAULT 0,
  putaway_sequence integer DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  notes text,
  layout_x numeric(10,2) DEFAULT 0,
  layout_y numeric(10,2) DEFAULT 0,
  layout_width numeric(10,2) DEFAULT 10,
  layout_height numeric(10,2) DEFAULT 12,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read locations" ON public.locations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert locations" ON public.locations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update locations" ON public.locations FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete locations" ON public.locations FOR DELETE TO authenticated USING (true);

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  allow_mixed_stock boolean NOT NULL DEFAULT false,
  allow_mixed_sku_pallet boolean NOT NULL DEFAULT false,
  allow_mixed_lot_pallet boolean NOT NULL DEFAULT false,
  require_expiry boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read clients" ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert clients" ON public.clients FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update clients" ON public.clients FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete clients" ON public.clients FOR DELETE TO authenticated USING (true);

-- ============================================================
-- PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  barcode text,
  name text NOT NULL,
  description text,
  client_owner_id uuid REFERENCES public.clients(id),
  product_family text,
  temperature_requirement public.temperature_class NOT NULL DEFAULT 'ambient',
  length numeric(10,2),
  width numeric(10,2),
  height numeric(10,2),
  weight numeric(10,2),
  stackable boolean NOT NULL DEFAULT true,
  max_stack_height integer DEFAULT 5,
  lot_tracked boolean NOT NULL DEFAULT true,
  batch_tracked boolean NOT NULL DEFAULT false,
  expiry_tracked boolean NOT NULL DEFAULT false,
  rotation_method public.rotation_method NOT NULL DEFAULT 'fifo',
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update products" ON public.products FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete products" ON public.products FOR DELETE TO authenticated USING (true);

-- ============================================================
-- PRODUCT PACKAGING PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_packaging_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  profile_name text NOT NULL,
  package_type text,
  units_per_package integer NOT NULL DEFAULT 1,
  length numeric(10,2),
  width numeric(10,2),
  height numeric(10,2),
  weight numeric(10,2),
  barcode text,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_packaging_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read product_packaging_profiles" ON public.product_packaging_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert product_packaging_profiles" ON public.product_packaging_profiles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update product_packaging_profiles" ON public.product_packaging_profiles FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete product_packaging_profiles" ON public.product_packaging_profiles FOR DELETE TO authenticated USING (true);

-- ============================================================
-- INVENTORY LOTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inventory_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  client_id uuid REFERENCES public.clients(id),
  lot_number text,
  batch_number text,
  manufacture_date date,
  expiry_date date,
  loading_date date,
  rotation_date date,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read inventory_lots" ON public.inventory_lots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert inventory_lots" ON public.inventory_lots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update inventory_lots" ON public.inventory_lots FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete inventory_lots" ON public.inventory_lots FOR DELETE TO authenticated USING (true);

-- ============================================================
-- RECEIPTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  receipt_type public.receipt_type NOT NULL DEFAULT 'po',
  reference_number text,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  source_warehouse_id uuid REFERENCES public.warehouses(id),
  client_id uuid REFERENCES public.clients(id),
  status public.task_status NOT NULL DEFAULT 'draft',
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read receipts" ON public.receipts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert receipts" ON public.receipts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update receipts" ON public.receipts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete receipts" ON public.receipts FOR DELETE TO authenticated USING (true);

-- ============================================================
-- RECEIPT LINES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  packaging_profile_id uuid REFERENCES public.product_packaging_profiles(id),
  client_id uuid REFERENCES public.clients(id),
  quantity numeric(14,2) NOT NULL DEFAULT 0,
  received_quantity numeric(14,2) NOT NULL DEFAULT 0,
  inventory_lot_id uuid REFERENCES public.inventory_lots(id),
  override_length numeric(10,2),
  override_width numeric(10,2),
  override_height numeric(10,2),
  override_weight numeric(10,2),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.receipt_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read receipt_lines" ON public.receipt_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert receipt_lines" ON public.receipt_lines FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update receipt_lines" ON public.receipt_lines FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete receipt_lines" ON public.receipt_lines FOR DELETE TO authenticated USING (true);

-- ============================================================
-- PALLETS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pallet_code text NOT NULL UNIQUE,
  pallet_barcode text NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id),
  client_id uuid REFERENCES public.clients(id),
  receipt_line_id uuid REFERENCES public.receipt_lines(id),
  current_location_id uuid REFERENCES public.locations(id),
  current_warehouse_id uuid REFERENCES public.warehouses(id),
  inventory_lot_id uuid REFERENCES public.inventory_lots(id),
  packaging_profile_id uuid REFERENCES public.product_packaging_profiles(id),
  quantity numeric(14,2) NOT NULL DEFAULT 0,
  available_quantity numeric(14,2) NOT NULL DEFAULT 0,
  reserved_quantity numeric(14,2) NOT NULL DEFAULT 0,
  held_quantity numeric(14,2) NOT NULL DEFAULT 0,
  damaged_quantity numeric(14,2) NOT NULL DEFAULT 0,
  status public.inventory_status NOT NULL DEFAULT 'receiving',
  is_stored boolean NOT NULL DEFAULT false,
  last_counted_at timestamptz,
  length numeric(10,2),
  width numeric(10,2),
  height numeric(10,2),
  weight numeric(10,2),
  stack_height integer DEFAULT 1,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read pallets" ON public.pallets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert pallets" ON public.pallets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update pallets" ON public.pallets FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete pallets" ON public.pallets FOR DELETE TO authenticated USING (true);

-- ============================================================
-- INVENTORY BALANCES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pallet_id uuid NOT NULL REFERENCES public.pallets(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  client_id uuid REFERENCES public.clients(id),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  zone_id uuid REFERENCES public.zones(id),
  location_id uuid REFERENCES public.locations(id),
  inventory_lot_id uuid REFERENCES public.inventory_lots(id),
  status public.inventory_status NOT NULL DEFAULT 'receiving',
  quantity numeric(14,2) NOT NULL DEFAULT 0,
  available_quantity numeric(14,2) NOT NULL DEFAULT 0,
  reserved_quantity numeric(14,2) NOT NULL DEFAULT 0,
  held_quantity numeric(14,2) NOT NULL DEFAULT 0,
  damaged_quantity numeric(14,2) NOT NULL DEFAULT 0,
  received_at timestamptz DEFAULT now(),
  expiry_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read inventory_balances" ON public.inventory_balances FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert inventory_balances" ON public.inventory_balances FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update inventory_balances" ON public.inventory_balances FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete inventory_balances" ON public.inventory_balances FOR DELETE TO authenticated USING (true);

-- ============================================================
-- PUTAWAY TASKS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.putaway_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_number text NOT NULL UNIQUE,
  pallet_id uuid NOT NULL REFERENCES public.pallets(id),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  suggested_location_id uuid REFERENCES public.locations(id),
  confirmed_location_id uuid REFERENCES public.locations(id),
  assigned_user_id uuid REFERENCES auth.users(id),
  status public.task_status NOT NULL DEFAULT 'queued',
  alternative_requested boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.putaway_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read putaway_tasks" ON public.putaway_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert putaway_tasks" ON public.putaway_tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update putaway_tasks" ON public.putaway_tasks FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete putaway_tasks" ON public.putaway_tasks FOR DELETE TO authenticated USING (true);

-- ============================================================
-- MOVE TASKS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.move_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_number text NOT NULL UNIQUE,
  pallet_id uuid NOT NULL REFERENCES public.pallets(id),
  from_location_id uuid REFERENCES public.locations(id),
  to_location_id uuid REFERENCES public.locations(id),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  transfer_id uuid,
  assigned_user_id uuid REFERENCES auth.users(id),
  status public.task_status NOT NULL DEFAULT 'queued',
  reason text,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.move_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read move_tasks" ON public.move_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert move_tasks" ON public.move_tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update move_tasks" ON public.move_tasks FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete move_tasks" ON public.move_tasks FOR DELETE TO authenticated USING (true);

-- ============================================================
-- ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  order_type text NOT NULL DEFAULT 'sales',
  client_id uuid REFERENCES public.clients(id),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  status public.task_status NOT NULL DEFAULT 'draft',
  priority integer NOT NULL DEFAULT 1,
  requested_ship_date date,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read orders" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update orders" ON public.orders FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete orders" ON public.orders FOR DELETE TO authenticated USING (true);

-- ============================================================
-- ORDER LINES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity numeric(14,2) NOT NULL DEFAULT 0,
  allocated_quantity numeric(14,2) NOT NULL DEFAULT 0,
  picked_quantity numeric(14,2) NOT NULL DEFAULT 0,
  inventory_lot_id uuid REFERENCES public.inventory_lots(id),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read order_lines" ON public.order_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert order_lines" ON public.order_lines FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update order_lines" ON public.order_lines FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete order_lines" ON public.order_lines FOR DELETE TO authenticated USING (true);

-- ============================================================
-- PICK LISTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pick_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_list_number text NOT NULL UNIQUE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  client_id uuid REFERENCES public.clients(id),
  order_id uuid REFERENCES public.orders(id),
  consolidated boolean NOT NULL DEFAULT false,
  status public.task_status NOT NULL DEFAULT 'draft',
  released_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pick_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read pick_lists" ON public.pick_lists FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert pick_lists" ON public.pick_lists FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update pick_lists" ON public.pick_lists FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete pick_lists" ON public.pick_lists FOR DELETE TO authenticated USING (true);

-- ============================================================
-- PICK TASKS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pick_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_number text NOT NULL UNIQUE,
  pick_list_id uuid NOT NULL REFERENCES public.pick_lists(id) ON DELETE CASCADE,
  order_line_id uuid REFERENCES public.order_lines(id),
  pallet_id uuid REFERENCES public.pallets(id),
  location_id uuid REFERENCES public.locations(id),
  staging_location_id uuid REFERENCES public.locations(id),
  assigned_user_id uuid REFERENCES auth.users(id),
  requested_quantity numeric(14,2) NOT NULL DEFAULT 0,
  confirmed_quantity numeric(14,2) NOT NULL DEFAULT 0,
  status public.task_status NOT NULL DEFAULT 'queued',
  short_reason text,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pick_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read pick_tasks" ON public.pick_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert pick_tasks" ON public.pick_tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update pick_tasks" ON public.pick_tasks FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete pick_tasks" ON public.pick_tasks FOR DELETE TO authenticated USING (true);

-- ============================================================
-- TRANSFERS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number text NOT NULL UNIQUE,
  transfer_type text NOT NULL DEFAULT 'inter_warehouse',
  source_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  destination_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  status public.task_status NOT NULL DEFAULT 'draft',
  dispatched_at timestamptz,
  received_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read transfers" ON public.transfers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert transfers" ON public.transfers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update transfers" ON public.transfers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete transfers" ON public.transfers FOR DELETE TO authenticated USING (true);

-- Add FK from move_tasks to transfers now that transfers exists
ALTER TABLE public.move_tasks
  ADD CONSTRAINT move_tasks_transfer_id_fkey
  FOREIGN KEY (transfer_id) REFERENCES public.transfers(id) ON DELETE SET NULL;

-- ============================================================
-- TRANSFER LINES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.transfers(id) ON DELETE CASCADE,
  pallet_id uuid NOT NULL REFERENCES public.pallets(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  client_id uuid REFERENCES public.clients(id),
  quantity numeric(14,2) NOT NULL DEFAULT 0,
  inventory_lot_id uuid REFERENCES public.inventory_lots(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.transfer_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read transfer_lines" ON public.transfer_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert transfer_lines" ON public.transfer_lines FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update transfer_lines" ON public.transfer_lines FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete transfer_lines" ON public.transfer_lines FOR DELETE TO authenticated USING (true);

-- ============================================================
-- CYCLE COUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cycle_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_number text NOT NULL UNIQUE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  zone_id uuid REFERENCES public.zones(id),
  location_id uuid REFERENCES public.locations(id),
  scope public.count_scope NOT NULL DEFAULT 'spot',
  status public.task_status NOT NULL DEFAULT 'queued',
  assigned_user_id uuid REFERENCES auth.users(id),
  variance_threshold_percent numeric(5,2) NOT NULL DEFAULT 5,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cycle_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read cycle_counts" ON public.cycle_counts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert cycle_counts" ON public.cycle_counts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update cycle_counts" ON public.cycle_counts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete cycle_counts" ON public.cycle_counts FOR DELETE TO authenticated USING (true);

-- ============================================================
-- CYCLE COUNT LINES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cycle_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_count_id uuid NOT NULL REFERENCES public.cycle_counts(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id),
  product_id uuid REFERENCES public.products(id),
  pallet_id uuid REFERENCES public.pallets(id),
  expected_quantity numeric(14,2) NOT NULL DEFAULT 0,
  counted_quantity numeric(14,2),
  variance_quantity numeric(14,2) DEFAULT 0,
  variance_percent numeric(8,2) DEFAULT 0,
  status public.task_status NOT NULL DEFAULT 'queued',
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cycle_count_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read cycle_count_lines" ON public.cycle_count_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert cycle_count_lines" ON public.cycle_count_lines FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update cycle_count_lines" ON public.cycle_count_lines FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete cycle_count_lines" ON public.cycle_count_lines FOR DELETE TO authenticated USING (true);

-- ============================================================
-- STOCK ADJUSTMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_number text NOT NULL,
  pallet_id uuid REFERENCES public.pallets(id),
  inventory_balance_id uuid REFERENCES public.inventory_balances(id),
  adjustment_type text NOT NULL DEFAULT 'status_change',
  quantity_delta numeric(14,2) NOT NULL DEFAULT 0,
  old_status public.inventory_status,
  new_status public.inventory_status,
  reason text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read stock_adjustments" ON public.stock_adjustments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert stock_adjustments" ON public.stock_adjustments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update stock_adjustments" ON public.stock_adjustments FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete stock_adjustments" ON public.stock_adjustments FOR DELETE TO authenticated USING (true);

-- ============================================================
-- BARCODE LABELS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.barcode_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_type text NOT NULL,
  entity_id uuid NOT NULL,
  label_code text NOT NULL,
  printed_by uuid REFERENCES auth.users(id),
  reprint_count integer NOT NULL DEFAULT 0,
  last_printed_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.barcode_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read barcode_labels" ON public.barcode_labels FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert barcode_labels" ON public.barcode_labels FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update barcode_labels" ON public.barcode_labels FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete barcode_labels" ON public.barcode_labels FOR DELETE TO authenticated USING (true);

-- ============================================================
-- AUDIT EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  entity_table text NOT NULL,
  entity_id uuid NOT NULL,
  warehouse_id uuid REFERENCES public.warehouses(id),
  pallet_id uuid REFERENCES public.pallets(id),
  from_location_id uuid REFERENCES public.locations(id),
  to_location_id uuid REFERENCES public.locations(id),
  actor_user_id uuid REFERENCES auth.users(id),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read audit_events" ON public.audit_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert audit_events" ON public.audit_events FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- VIEWS
-- ============================================================
CREATE OR REPLACE VIEW public.inventory_search_view AS
SELECT
  ib.id AS inventory_balance_id,
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
FROM public.inventory_balances ib
JOIN public.pallets p ON p.id = ib.pallet_id
JOIN public.products pr ON pr.id = ib.product_id
LEFT JOIN public.clients c ON c.id = ib.client_id
LEFT JOIN public.inventory_lots il ON il.id = ib.inventory_lot_id
JOIN public.warehouses w ON w.id = ib.warehouse_id
LEFT JOIN public.zones z ON z.id = ib.zone_id
LEFT JOIN public.locations l ON l.id = ib.location_id;

CREATE OR REPLACE VIEW public.location_occupancy_view AS
SELECT
  l.id AS location_id,
  l.code AS location_code,
  l.temperature_class,
  l.max_pallets,
  l.location_type,
  w.code AS warehouse_code,
  z.code AS zone_code,
  COUNT(ib.id)::integer AS occupied_pallets,
  (COUNT(ib.id) >= l.max_pallets) AS is_full
FROM public.locations l
JOIN public.warehouses w ON w.id = l.warehouse_id
JOIN public.zones z ON z.id = l.zone_id
LEFT JOIN public.inventory_balances ib ON ib.location_id = l.id
GROUP BY l.id, l.code, l.temperature_class, l.max_pallets, l.location_type, w.code, z.code;

-- Add dispatch_driver role if not exists
INSERT INTO public.roles (code, name, description)
VALUES ('dispatch_driver', 'Dispatch Driver', 'Confirms transfer dispatches and receives stock between facilities')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;
