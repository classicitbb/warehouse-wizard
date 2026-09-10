ALTER TABLE public.permission_features
  ADD COLUMN IF NOT EXISTS is_released boolean NOT NULL DEFAULT true;

INSERT INTO public.permission_features (code, name, description, sort_order, is_released)
VALUES ('pack_designer', 'Pallet Pak Designer', 'Design and save pallet pack standards', 145, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, feature_id, can_view, can_edit)
SELECT r.id, f.id,
       true,
       r.code IN ('developer','admin','warehouse_manager','inventory_clerk')
FROM public.roles r
CROSS JOIN public.permission_features f
WHERE f.code = 'pack_designer'
  AND r.code IN ('developer','admin','warehouse_manager','inventory_clerk')
ON CONFLICT DO NOTHING;