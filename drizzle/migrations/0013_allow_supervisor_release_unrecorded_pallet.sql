-- Supervisors already see the unrecorded-pallet banner, so they must be able to
-- act on it. Aligns the guard with has_min_role('warehouse_supervisor').
CREATE OR REPLACE FUNCTION public.release_unrecorded_pallet_location(
  in_pallet_id uuid,
  in_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_pallet public.pallets;
  v_location_id uuid;
  v_has_balance boolean;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role_code)
    OR public.has_role(auth.uid(), 'developer'::public.app_role_code)
    OR public.has_role(auth.uid(), 'dev'::public.app_role_code)
    OR public.has_min_role(auth.uid(), 'warehouse_supervisor')
  ) THEN
    RAISE EXCEPTION 'Only supervisors, warehouse managers and admins can release an unrecorded pallet.';
  END IF;

  SELECT * INTO v_pallet FROM public.pallets WHERE id = in_pallet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pallet not found.';
  END IF;

  v_location_id := v_pallet.current_location_id;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory_balances b
    WHERE b.pallet_id = in_pallet_id
      AND b.status NOT IN ('shipped', 'in_transit', 'missing')
  ) INTO v_has_balance;

  UPDATE public.pallets
     SET status = 'missing',
         is_stored = false,
         current_location_id = NULL
   WHERE id = in_pallet_id;

  IF v_has_balance THEN
    UPDATE public.inventory_balances
       SET status = 'missing',
           location_id = NULL,
           zone_id = NULL
     WHERE pallet_id = in_pallet_id
       AND status NOT IN ('shipped', 'in_transit', 'missing');
  END IF;

  PERFORM public.log_audit_event(
    'unrecorded_pallet_location_released',
    'pallets',
    in_pallet_id,
    v_pallet.current_warehouse_id,
    in_pallet_id,
    v_location_id,
    NULL,
    jsonb_build_object(
      'reason', COALESCE(in_reason, 'Pallet had no stock record and could not be stored'),
      'pallet_barcode', v_pallet.pallet_barcode,
      'had_balance', v_has_balance
    )
  );

  RETURN jsonb_build_object(
    'pallet_id', in_pallet_id,
    'released_location_id', v_location_id,
    'status', 'missing'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_unrecorded_pallet_location(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_unrecorded_pallet_location(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.release_unrecorded_pallet_location(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_unrecorded_pallet_location(uuid, text) TO service_role;
