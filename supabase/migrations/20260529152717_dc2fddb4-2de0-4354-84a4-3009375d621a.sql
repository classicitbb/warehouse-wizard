-- Restrict integration_connections read access to admins & warehouse managers only
DROP POLICY IF EXISTS "Approved users read integration_connections" ON public.integration_connections;

CREATE POLICY "Managers read integration_connections"
  ON public.integration_connections
  FOR SELECT
  TO authenticated
  USING (has_any_role(ARRAY['admin'::app_role_code, 'warehouse_manager'::app_role_code]));

-- Harden profile self-update: prevent users from flipping `approved` to true at the RLS layer
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND approved IS NOT DISTINCT FROM (SELECT p.approved FROM public.profiles p WHERE p.id = auth.uid())
  );