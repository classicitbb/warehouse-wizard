
-- 1. Profiles: prevent self-approval at the RLS layer
DROP POLICY IF EXISTS "profiles users update own row" ON public.profiles;
CREATE POLICY "profiles users update own row"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND approved IS NOT DISTINCT FROM (SELECT p.approved FROM public.profiles p WHERE p.id = auth.uid())
  AND active   IS NOT DISTINCT FROM (SELECT p.active   FROM public.profiles p WHERE p.id = auth.uid())
);

-- 2. Set search_path on email queue helpers
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;

-- 3. Revoke anonymous EXECUTE on SECURITY DEFINER functions (all require an authenticated user)
REVOKE EXECUTE ON FUNCTION public._delete_guard_check() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_invite_user(text, text, text, text, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_user_password(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_client_cascade(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_location_cascade(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_product_cascade(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_warehouse_cascade(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_zone_cascade(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_audit_event(text, text, uuid, uuid, uuid, uuid, uuid, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_invite_user(text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_password(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_cascade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_location_cascade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_product_cascade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_warehouse_cascade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_zone_cascade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, uuid, uuid, uuid, uuid, uuid, jsonb) TO authenticated;
