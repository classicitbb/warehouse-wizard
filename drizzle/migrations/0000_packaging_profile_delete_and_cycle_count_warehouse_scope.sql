-- 1. Packaging profiles: supervisors and up may create, edit and delete.
DROP POLICY IF EXISTS "Managers delete product_packaging_profiles" ON public.product_packaging_profiles;
CREATE POLICY "Supervisors delete product_packaging_profiles"
ON public.product_packaging_profiles FOR DELETE TO authenticated
USING (is_approved() AND has_min_role(auth.uid(), 'warehouse_supervisor'));

DROP POLICY IF EXISTS "Managers update product_packaging_profiles" ON public.product_packaging_profiles;
CREATE POLICY "Supervisors update product_packaging_profiles"
ON public.product_packaging_profiles FOR UPDATE TO authenticated
USING (is_approved() AND has_min_role(auth.uid(), 'warehouse_supervisor'))
WITH CHECK (is_approved() AND has_min_role(auth.uid(), 'warehouse_supervisor'));

DROP POLICY IF EXISTS "Managers write product_packaging_profiles" ON public.product_packaging_profiles;
CREATE POLICY "Supervisors write product_packaging_profiles"
ON public.product_packaging_profiles FOR INSERT TO authenticated
WITH CHECK (is_approved() AND has_min_role(auth.uid(), 'warehouse_supervisor'));

-- 2. Guarded permanent delete for a single packaging profile.
CREATE OR REPLACE FUNCTION public.delete_packaging_profile_cascade(in_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  blockers jsonb := '[]'::jsonb;
  c bigint;
begin
  if not (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_supervisor')) then
    raise exception 'Only supervisors, managers, admins or developers can delete packaging profiles';
  end if;

  select count(*) into c from public.pallets where packaging_profile_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','pallets','count',c); end if;
  select count(*) into c from public.receipt_lines where packaging_profile_id = in_id;
  if c > 0 then blockers := blockers || jsonb_build_object('table','receipt_lines','count',c); end if;

  if jsonb_array_length(blockers) > 0 then
    return jsonb_build_object('ok', false, 'blocked_by', blockers);
  end if;

  update public.product_packaging_profiles set superseded_by_id = null where superseded_by_id = in_id;
  delete from public.product_packaging_profiles where id = in_id;
  return jsonb_build_object('ok', true);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_packaging_profile_cascade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_packaging_profile_cascade(uuid) TO authenticated;

-- 3. Security findings: scope cycle count reads to accessible warehouses.
DROP POLICY IF EXISTS "Cycle count headers visible by role or team" ON public.cycle_counts;
CREATE POLICY "Cycle count headers visible by role or team"
ON public.cycle_counts FOR SELECT TO authenticated
USING (
  is_approved() AND (
    (has_min_role(auth.uid(), 'warehouse_supervisor') AND can_access_warehouse(warehouse_id))
    OR initiated_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.cycle_count_assignees assignee
      WHERE assignee.cycle_count_id = cycle_counts.id AND assignee.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "Cycle count lines visible by role or team" ON public.cycle_count_lines;
CREATE POLICY "Cycle count lines visible by role or team"
ON public.cycle_count_lines FOR SELECT TO authenticated
USING (
  is_approved() AND (
    (
      has_min_role(auth.uid(), 'warehouse_supervisor')
      AND EXISTS (
        SELECT 1 FROM public.cycle_counts header
        WHERE header.id = cycle_count_lines.cycle_count_id
          AND can_access_warehouse(header.warehouse_id)
      )
    )
    OR assigned_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.cycle_count_assignees assignee
      WHERE assignee.cycle_count_id = cycle_count_lines.cycle_count_id AND assignee.user_id = auth.uid()
    )
  )
);
