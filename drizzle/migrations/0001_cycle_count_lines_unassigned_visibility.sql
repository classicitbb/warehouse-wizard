DROP POLICY IF EXISTS "Cycle count lines visible by role or team" ON public.cycle_count_lines;
CREATE POLICY "Cycle count lines visible by role or team"
ON public.cycle_count_lines FOR SELECT TO authenticated
USING (
  is_approved() AND (
    assigned_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.cycle_count_assignees assignee
      WHERE assignee.cycle_count_id = cycle_count_lines.cycle_count_id AND assignee.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.cycle_counts header
      WHERE header.id = cycle_count_lines.cycle_count_id
        AND can_access_warehouse(header.warehouse_id)
        AND (has_min_role(auth.uid(), 'warehouse_supervisor') OR cycle_count_lines.assigned_user_id IS NULL)
    )
  )
);
