-- Revoke anonymous EXECUTE on SECURITY DEFINER functions that must require sign-in
REVOKE EXECUTE ON FUNCTION public.accessible_transfer_pallet_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.accessible_warehouse_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_metrics_summary(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_user_role_event() FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_user_role_event() FROM authenticated;

-- Gate RBAC metadata reads behind approval status
DROP POLICY IF EXISTS "Authenticated users can read roles" ON public.roles;
CREATE POLICY "Authenticated users can read roles"
  ON public.roles FOR SELECT TO authenticated
  USING (public.is_approved());

DROP POLICY IF EXISTS "permission features read authenticated" ON public.permission_features;
CREATE POLICY "permission features read authenticated"
  ON public.permission_features FOR SELECT TO authenticated
  USING (public.is_approved());

DROP POLICY IF EXISTS "role permissions read authenticated" ON public.role_permissions;
CREATE POLICY "role permissions read authenticated"
  ON public.role_permissions FOR SELECT TO authenticated
  USING (public.is_approved());
