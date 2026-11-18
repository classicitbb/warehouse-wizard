-- 1. Pin search_path on remaining mutable functions
ALTER FUNCTION public.effective_clearance_mm(integer, integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.location_clearance_mm(integer, numeric, integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.pallet_height_mm(integer, numeric) SET search_path = public, pg_catalog;

-- 2. Revoke anonymous EXECUTE on SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.accessible_transfer_pallet_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.accessible_warehouse_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_integration_sync_jobs(uuid, integer, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_metrics_summary(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_user_role_event() FROM anon, authenticated;

-- 3. Require approved accounts to upload ticket screenshots
DROP POLICY IF EXISTS "Reporters upload own ticket screenshots" ON storage.objects;
CREATE POLICY "Reporters upload own ticket screenshots"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'ticket-screenshots'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND public.is_approved()
);