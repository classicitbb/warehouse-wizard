-- 1. Cycle count policies: add approval gate
DROP POLICY IF EXISTS "Cycle count headers visible by role or team" ON public.cycle_counts;
CREATE POLICY "Cycle count headers visible by role or team"
ON public.cycle_counts FOR SELECT TO authenticated
USING (
  public.is_approved() AND (
    public.has_min_role(auth.uid(), 'warehouse_supervisor')
    OR initiated_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.cycle_count_assignees assignee
      WHERE assignee.cycle_count_id = cycle_counts.id AND assignee.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "Supervisors create cycle count headers" ON public.cycle_counts;
CREATE POLICY "Supervisors create cycle count headers"
ON public.cycle_counts FOR INSERT TO authenticated
WITH CHECK (public.is_approved() AND public.has_min_role(auth.uid(), 'warehouse_supervisor'));

DROP POLICY IF EXISTS "Cycle count lines visible by role or team" ON public.cycle_count_lines;
CREATE POLICY "Cycle count lines visible by role or team"
ON public.cycle_count_lines FOR SELECT TO authenticated
USING (
  public.is_approved() AND (
    public.has_min_role(auth.uid(), 'warehouse_supervisor')
    OR assigned_user_id = auth.uid()
    OR assigned_user_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.cycle_count_assignees assignee
      WHERE assignee.cycle_count_id = cycle_count_lines.cycle_count_id AND assignee.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "Supervisors create cycle count lines" ON public.cycle_count_lines;
CREATE POLICY "Supervisors create cycle count lines"
ON public.cycle_count_lines FOR INSERT TO authenticated
WITH CHECK (public.is_approved() AND public.has_min_role(auth.uid(), 'warehouse_supervisor'));

DROP POLICY IF EXISTS "Cycle-count team members can read their assignments" ON public.cycle_count_assignees;
CREATE POLICY "Cycle-count team members can read their assignments"
ON public.cycle_count_assignees FOR SELECT TO authenticated
USING (
  public.is_approved() AND (
    user_id = auth.uid() OR public.has_min_role(auth.uid(), 'warehouse_supervisor')
  )
);

-- 2. System logs: correct role code typo
DROP POLICY IF EXISTS "Staff can read system logs" ON public.system_logs;
CREATE POLICY "Staff can read system logs"
ON public.system_logs FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'developer')
  OR public.has_role(auth.uid(), 'warehouse_manager')
);

DROP POLICY IF EXISTS "Staff can read system logs archive" ON public.system_logs_archive;
CREATE POLICY "Staff can read system logs archive"
ON public.system_logs_archive FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'developer')
  OR public.has_role(auth.uid(), 'warehouse_manager')
);

-- 3. Storage: scope wms buckets to the uploader plus management roles
DROP POLICY IF EXISTS "Approved users manage wms storage objects" ON storage.objects;
CREATE POLICY "Owners and managers read wms storage objects"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = ANY (ARRAY['labels','imports','attachments'])
  AND public.is_approved()
  AND (owner = auth.uid() OR public.has_min_role(auth.uid(), 'warehouse_manager'))
);

CREATE POLICY "Approved users upload own wms storage objects"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = ANY (ARRAY['labels','imports','attachments'])
  AND public.is_approved()
  AND owner = auth.uid()
);

CREATE POLICY "Owners and managers update wms storage objects"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = ANY (ARRAY['labels','imports','attachments'])
  AND public.is_approved()
  AND (owner = auth.uid() OR public.has_min_role(auth.uid(), 'warehouse_manager'))
)
WITH CHECK (
  bucket_id = ANY (ARRAY['labels','imports','attachments'])
  AND public.is_approved()
  AND (owner = auth.uid() OR public.has_min_role(auth.uid(), 'warehouse_manager'))
);

CREATE POLICY "Owners and managers delete wms storage objects"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = ANY (ARRAY['labels','imports','attachments'])
  AND public.is_approved()
  AND (owner = auth.uid() OR public.has_min_role(auth.uid(), 'warehouse_manager'))
);

-- 4. Pin search_path on email queue helpers
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = '';
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = '';
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = '';
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = '';

-- 5. SECURITY DEFINER surface: remove execute from anonymous/public where not needed
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_wms_data() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_user_password(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_user_pin(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_user_pin(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_sign_out_all_sessions(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.archive_system_log(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.archive_system_logs_older_than(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_client_cascade(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_location_cascade(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_product_cascade(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_warehouse_cascade(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_zone_cascade(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirm_pick_task(uuid, text, text, numeric, boolean, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.preview_pick_source_override(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.write_system_log(text, text, text, text, jsonb, text, text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_audit_event(text, text, uuid, uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_cycle_count_line(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.release_cycle_count_line_claim(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assert_location_not_frozen(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;