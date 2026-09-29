-- Restore profiles access for authenticated users (lost during prior security hardening).
-- pin_hash and badge_code remain restricted to service_role (accessed via security-definer RPCs).

GRANT SELECT (id, full_name, email, phone, approved, created_at, updated_at, active, default_warehouse_id, user_code) ON public.profiles TO authenticated;
GRANT INSERT (id, full_name, email, phone, approved, active, default_warehouse_id, user_code) ON public.profiles TO authenticated;
GRANT UPDATE (full_name, email, phone, active, default_warehouse_id, user_code) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- Ensure system_logs read access still works for approved users.
GRANT SELECT, INSERT ON public.system_logs TO authenticated;
GRANT ALL ON public.system_logs TO service_role;

-- Ensure user_roles & roles remain readable (needed for role checks during login).
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT ON public.roles TO authenticated;