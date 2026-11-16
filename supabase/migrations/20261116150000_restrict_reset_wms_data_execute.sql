REVOKE EXECUTE ON FUNCTION public.reset_wms_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_wms_data() TO authenticated, service_role;
