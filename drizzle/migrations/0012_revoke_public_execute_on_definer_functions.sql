REVOKE EXECUTE ON FUNCTION public.accessible_transfer_pallet_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accessible_warehouse_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dashboard_metrics_summary(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_user_role_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accessible_transfer_pallet_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accessible_warehouse_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_metrics_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_user_role_event() TO service_role;
