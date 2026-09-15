-- Restore the original semantics that the previous rewrite widened:
-- receipts may be deleted by anyone scoped only while still a draft,
-- and NULL warehouse rows are not implicitly visible on locations/receipts.

DROP POLICY IF EXISTS "Scoped delete receipts" ON public.receipts;
CREATE POLICY "Scoped delete receipts" ON public.receipts FOR DELETE TO authenticated
USING (
  (SELECT public.is_approved())
  AND COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
  AND (status = 'draft'::task_status OR (SELECT public.has_min_role(auth.uid(), 'warehouse_manager')))
);

DROP POLICY IF EXISTS "Scoped read receipts" ON public.receipts;
CREATE POLICY "Scoped read receipts" ON public.receipts FOR SELECT TO authenticated
USING (
  (SELECT public.is_approved())
  AND COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
);

DROP POLICY IF EXISTS "Scoped update receipts" ON public.receipts;
CREATE POLICY "Scoped update receipts" ON public.receipts FOR UPDATE TO authenticated
USING (
  (SELECT public.is_approved())
  AND COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
)
WITH CHECK (
  (SELECT public.is_approved())
  AND COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
);

DROP POLICY IF EXISTS "Scoped insert receipts" ON public.receipts;
CREATE POLICY "Scoped insert receipts" ON public.receipts FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_approved())
  AND COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
);

DROP POLICY IF EXISTS "Scoped read locations" ON public.locations;
CREATE POLICY "Scoped read locations" ON public.locations FOR SELECT TO authenticated
USING (
  (SELECT public.is_approved())
  AND COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
);