REVOKE ALL ON FUNCTION public.confirm_pick_task(uuid, text, text, numeric, boolean, boolean, boolean) FROM anon, public;
REVOKE ALL ON FUNCTION public.create_pick_shortfall_task(uuid, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.confirm_pick_task(uuid, text, text, numeric, boolean, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_pick_shortfall_task(uuid, numeric) TO authenticated, service_role;