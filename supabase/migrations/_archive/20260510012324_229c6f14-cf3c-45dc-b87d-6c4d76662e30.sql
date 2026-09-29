REVOKE EXECUTE ON FUNCTION public.has_role(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_any_role(app_role_code[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_approved() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_self_approval() FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(app_role_code[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved() TO authenticated;