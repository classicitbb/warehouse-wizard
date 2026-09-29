-- Configurable feature-level permissions for the admin Role Matrix.
-- Role assignment remains many-to-many in user_roles; an empty assignment is
-- valid and intentionally means no operational access.

CREATE TABLE IF NOT EXISTS public.permission_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES public.permission_features(id) ON DELETE CASCADE,
  can_view boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (role_id, feature_id),
  CONSTRAINT role_permissions_edit_requires_view CHECK (can_edit = false OR can_view = true)
);

ALTER TABLE public.permission_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permission features read authenticated" ON public.permission_features;
CREATE POLICY "permission features read authenticated"
  ON public.permission_features FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "permission features admin manage" ON public.permission_features;
CREATE POLICY "permission features admin manage"
  ON public.permission_features FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "role permissions read authenticated" ON public.role_permissions;
CREATE POLICY "role permissions read authenticated"
  ON public.role_permissions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "role permissions admin manage" ON public.role_permissions;
CREATE POLICY "role permissions admin manage"
  ON public.role_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.permission_features (code, name, description, sort_order) VALUES
  ('dashboard', 'Dashboard', 'Warehouse metrics and operational overview', 10),
  ('receiving', 'Receiving', 'Receive pallets and manage receiving drafts', 20),
  ('putaway', 'Put-Away', 'Assign and complete put-away tasks', 30),
  ('inventory', 'Inventory Search', 'Search inventory and view pallet detail', 40),
  ('pick_lists', 'Pick Lists', 'Create and execute pick lists', 50),
  ('location_moves', 'Location Moves', 'Move stock between locations', 60),
  ('cycle_counts', 'Cycle Counts', 'Run and resolve cycle counts', 70),
  ('transfers', 'Transfers', 'Manage inter-warehouse transfers', 80),
  ('warehouses', 'Warehouses', 'Manage warehouse records', 90),
  ('zones', 'Zones', 'Manage warehouse zones', 100),
  ('locations', 'Locations', 'Manage bin locations', 110),
  ('products', 'Products', 'Manage product catalog', 120),
  ('clients', 'Clients', 'Manage client records', 130),
  ('packaging', 'Packaging Profiles', 'Manage packaging profiles', 140),
  ('reports', 'Reports', 'View operational reports', 150),
  ('status', 'Statuses', 'Review inventory and task statuses', 160),
  ('system_log', 'System Log', 'Review system activity and errors', 170),
  ('email_log', 'Email Log', 'Review outbound email activity', 180),
  ('users_roles', 'Users & Roles', 'Manage users, roles, and permissions', 190)
ON CONFLICT (code) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = timezone('utc', now());

-- Seed the current hard-coded navigation policy so deploying this migration is
-- behavior-preserving. Admins can then tune each role independently.
INSERT INTO public.role_permissions (role_id, feature_id, can_view, can_edit)
SELECT r.id, f.id,
  CASE
    WHEN r.code IN ('admin', 'developer') THEN true
    WHEN f.code IN ('dashboard', 'receiving', 'putaway', 'inventory', 'pick_lists', 'location_moves', 'cycle_counts', 'transfers', 'warehouses', 'zones', 'locations', 'products', 'clients', 'packaging', 'reports', 'status', 'system_log')
      AND r.code IN ('warehouse_manager', 'warehouse_supervisor', 'inventory_clerk', 'warehouse_operator', 'dispatch_driver') THEN
      f.code = ANY(CASE r.code
        WHEN 'warehouse_manager' THEN ARRAY['dashboard','receiving','putaway','inventory','pick_lists','location_moves','cycle_counts','transfers','products','reports','status']
        WHEN 'warehouse_supervisor' THEN ARRAY['dashboard','receiving','putaway','inventory','pick_lists','location_moves','cycle_counts','transfers','products','reports','status']
        WHEN 'inventory_clerk' THEN ARRAY['dashboard','receiving','putaway','inventory','location_moves','cycle_counts','transfers','products','packaging','reports','status']
        WHEN 'warehouse_operator' THEN ARRAY['dashboard','putaway','inventory','pick_lists','location_moves','cycle_counts']
        WHEN 'dispatch_driver' THEN ARRAY['dashboard','transfers']
        ELSE ARRAY[]::text[] END)
    ELSE false
  END,
  CASE
    WHEN r.code IN ('admin', 'developer') THEN true
    WHEN r.code IN ('warehouse_manager', 'warehouse_supervisor') AND f.code IN ('receiving','putaway','inventory','pick_lists','location_moves','cycle_counts','transfers','warehouses','zones','locations','products','clients','packaging','reports','status','system_log') THEN true
    WHEN r.code = 'inventory_clerk' AND f.code IN ('receiving','putaway','inventory','location_moves','cycle_counts','products','packaging') THEN true
    WHEN r.code = 'warehouse_operator' AND f.code IN ('putaway','inventory','pick_lists','location_moves','cycle_counts') THEN true
    ELSE false
  END
FROM public.roles r CROSS JOIN public.permission_features f
ON CONFLICT (role_id, feature_id) DO NOTHING;
