-- 1. Warehouse-scoped SELECT policies
DROP POLICY IF EXISTS "Approved users can read audit_events" ON public.audit_events;
CREATE POLICY "Approved users can read audit_events" ON public.audit_events
FOR SELECT TO authenticated
USING (is_approved() AND (warehouse_id IS NULL OR can_access_warehouse(warehouse_id)));

DROP POLICY IF EXISTS "Approved users read cycle_count_schedules" ON public.cycle_count_schedules;
CREATE POLICY "Approved users read cycle_count_schedules" ON public.cycle_count_schedules
FOR SELECT TO authenticated
USING (is_approved() AND (warehouse_id IS NULL OR can_access_warehouse(warehouse_id)));

DROP POLICY IF EXISTS "Approved users read inventory_freezes" ON public.inventory_freezes;
CREATE POLICY "Approved users read inventory_freezes" ON public.inventory_freezes
FOR SELECT TO authenticated
USING (is_approved() AND (warehouse_id IS NULL OR can_access_warehouse(warehouse_id)));

DROP POLICY IF EXISTS "Approved users read printer_stations" ON public.printer_stations;
CREATE POLICY "Approved users read printer_stations" ON public.printer_stations
FOR SELECT TO authenticated
USING (is_approved() AND (warehouse_id IS NULL OR can_access_warehouse(warehouse_id)));

DROP POLICY IF EXISTS "Approved users read reorder alerts" ON public.reorder_alerts;
CREATE POLICY "Approved users read reorder alerts" ON public.reorder_alerts
FOR SELECT TO authenticated
USING (is_approved() AND (warehouse_id IS NULL OR can_access_warehouse(warehouse_id)));

DROP POLICY IF EXISTS "Approved users read return_authorizations" ON public.return_authorizations;
CREATE POLICY "Approved users read return_authorizations" ON public.return_authorizations
FOR SELECT TO authenticated
USING (is_approved() AND (warehouse_id IS NULL OR can_access_warehouse(warehouse_id)));

DROP POLICY IF EXISTS "Approved users read dock_appointments" ON public.dock_appointments;
CREATE POLICY "Approved users read dock_appointments" ON public.dock_appointments
FOR SELECT TO authenticated
USING (is_approved() AND (warehouse_id IS NULL OR can_access_warehouse(warehouse_id)));

DROP POLICY IF EXISTS "Approved users read replenishment_tasks" ON public.replenishment_tasks;
CREATE POLICY "Approved users read replenishment_tasks" ON public.replenishment_tasks
FOR SELECT TO authenticated
USING (is_approved() AND (warehouse_id IS NULL OR can_access_warehouse(warehouse_id)));

DROP POLICY IF EXISTS "Approved users read quality_inspections" ON public.quality_inspections;
CREATE POLICY "Approved users read quality_inspections" ON public.quality_inspections
FOR SELECT TO authenticated
USING (
  is_approved()
  AND (
    has_unrestricted_warehouse_access()
    OR EXISTS (SELECT 1 FROM public.pallets p WHERE p.id = quality_inspections.pallet_id AND can_access_warehouse(p.current_warehouse_id))
    OR EXISTS (SELECT 1 FROM public.receipts r WHERE r.id = quality_inspections.receipt_id AND can_access_warehouse(r.warehouse_id))
  )
);

DROP POLICY IF EXISTS "Approved users read staging_loads" ON public.staging_loads;
CREATE POLICY "Approved users read staging_loads" ON public.staging_loads
FOR SELECT TO authenticated
USING (
  is_approved()
  AND (
    has_unrestricted_warehouse_access()
    OR EXISTS (SELECT 1 FROM public.pick_lists pl WHERE pl.id = staging_loads.pick_list_id AND can_access_warehouse(pl.warehouse_id))
    OR EXISTS (SELECT 1 FROM public.dock_appointments da WHERE da.id = staging_loads.dock_appointment_id AND can_access_warehouse(da.warehouse_id))
  )
);

-- 2. Hidden client variables restricted to managers/admins
DROP POLICY IF EXISTS "Approved users read client_variables" ON public.client_variables;
CREATE POLICY "Approved users read client_variables" ON public.client_variables
FOR SELECT TO authenticated
USING (
  is_approved()
  AND (
    COALESCE(is_hidden, false) = false
    OR has_any_role(ARRAY['admin'::app_role_code, 'warehouse_manager'::app_role_code, 'dev'::app_role_code, 'developer'::app_role_code])
  )
);

-- 3. Badge PIN hashes not readable through the Data API
REVOKE SELECT (pin_hash) ON public.profiles FROM authenticated, anon;

-- 4. Fixed search_path on remaining SECURITY DEFINER helpers
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq, extensions;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq, extensions;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq, extensions;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq, extensions;

-- 5. Internal-only SECURITY DEFINER functions: not callable by app users
REVOKE ALL ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_deployment_licence() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.email_queue_dispatch() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_integration_sync_jobs(uuid, integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.reclaim_stale_integration_sync_jobs() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_system_log_archive() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_reorder_alerts() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.evaluate_reorder_alert(uuid, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_or_create_unsubscribe_token(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_invite_user(text, text, text, text, uuid) FROM anon, authenticated;

-- Trigger-only functions should never be directly callable
REVOKE ALL ON FUNCTION public.enforce_developer_role_unassigner() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.preserve_user_role_assigned_by() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.set_user_role_assigned_by() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_cycle_count_line_variance() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_reorder_alert_from_balance() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_reorder_alert_from_product() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_reorder_alert_from_settings() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public._delete_guard_check() FROM anon, authenticated;