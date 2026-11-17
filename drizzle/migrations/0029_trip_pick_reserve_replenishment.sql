CREATE OR REPLACE FUNCTION public.trip_pick_reserve(p_task_id uuid, p_request boolean DEFAULT false, p_expected_pallet_id uuid DEFAULT null)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  task public.pick_tasks%rowtype;
  list public.pick_lists%rowtype;
  v_product uuid;
  v_target uuid;
  v_source record;
  v_open public.replenishment_tasks%rowtype;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved() THEN RAISE EXCEPTION 'Not authorized to pick'; END IF;
  SELECT * INTO task FROM public.pick_tasks WHERE id = p_task_id;
  IF NOT FOUND OR task.fulfillment_line_id IS NULL THEN RAISE EXCEPTION 'Trip pick line not found.'; END IF;
  SELECT * INTO list FROM public.pick_lists WHERE id = task.pick_list_id;
  IF NOT public.can_access_warehouse(list.warehouse_id) THEN RAISE EXCEPTION 'Not authorized for this warehouse'; END IF;
  SELECT product_id INTO v_product FROM public.order_fulfillment_lines WHERE id = task.fulfillment_line_id;
  IF v_product IS NULL THEN RETURN jsonb_build_object('source', null, 'destination', null, 'replenishment', null); END IF;
  IF p_request THEN
    IF task.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'This line is already closed. Refresh the pick list.'; END IF;
    IF EXISTS (SELECT 1 FROM public.order_fulfillments WHERE id = list.fulfillment_id AND external_status NOT IN ('A', 'B')) THEN RAISE EXCEPTION 'This fulfillment is already shipped.'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(list.warehouse_id::text || ':' || v_product::text, 0));
  END IF;
  SELECT * INTO v_open FROM public.replenishment_tasks
  WHERE warehouse_id = list.warehouse_id AND product_id = v_product AND status IN ('queued', 'assigned', 'in_progress')
  ORDER BY created_at, id LIMIT 1;
  IF v_open.id IS NOT NULL THEN
    IF p_request THEN
      UPDATE public.replenishment_tasks SET priority = 'urgent', reason = 'manual' WHERE id = v_open.id RETURNING * INTO v_open;
    END IF;
    SELECT jsonb_build_object('pallet_id', p.id, 'barcode', p.pallet_barcode, 'bin', l.code,
      'available_quantity', p.available_quantity, 'received_at', p.received_at, 'expiry_date', p.expiry_date)
    INTO v_result FROM public.pallets p JOIN public.locations l ON l.id = v_open.from_location_id WHERE p.id = v_open.suggested_pallet_id;
    RETURN jsonb_build_object('source', v_result, 'destination', (SELECT code FROM public.locations WHERE id=v_open.to_location_id),
      'replenishment', jsonb_build_object('id', v_open.id, 'task_number', v_open.task_number, 'status', v_open.status));
  END IF;
  SELECT id INTO v_target FROM public.locations WHERE id = task.location_id AND warehouse_id = list.warehouse_id AND status = 'pick_face';
  IF v_target IS NULL THEN v_target := public.pick_face_target(list.warehouse_id, v_product); END IF;
  SELECT s.* INTO v_source FROM public.replenishment_source_pallet(list.warehouse_id, v_product) s
  JOIN public.pallets p ON p.id = s.pallet_id AND p.current_location_id = s.location_id
    AND p.current_warehouse_id = list.warehouse_id AND p.status = 'available' AND p.available_quantity > 0
    AND coalesce(p.correction_state, '') NOT IN ('draft', 'superseded', 'retired');
  IF p_request THEN
    IF v_source.pallet_id IS NULL THEN RAISE EXCEPTION 'No eligible reserve pallet is available. Ask a supervisor to check stock.'; END IF;
    IF p_expected_pallet_id IS DISTINCT FROM v_source.pallet_id THEN RAISE EXCEPTION 'The oldest reserve pallet has changed. Refresh and request again.'; END IF;
    IF v_target IS NULL THEN RAISE EXCEPTION 'No pick face is available. Ask a supervisor to make room.'; END IF;
    SELECT * INTO v_open FROM public.replenishment_tasks WHERE id = public.request_urgent_replenishment(v_target, v_product, 'manual');
    IF v_open.suggested_pallet_id IS DISTINCT FROM v_source.pallet_id OR v_open.status = 'exception' THEN RAISE EXCEPTION 'Reserve stock changed. Refresh and request again.'; END IF;
  END IF;
  SELECT jsonb_build_object('pallet_id', p.id, 'barcode', p.pallet_barcode, 'bin', l.code,
    'available_quantity', v_source.available_quantity, 'received_at', coalesce(ib.received_at, ib.created_at), 'expiry_date', ib.expiry_date)
  INTO v_result FROM public.pallets p JOIN public.locations l ON l.id = v_source.location_id
  JOIN public.inventory_balances ib ON ib.pallet_id=p.id AND ib.location_id=l.id AND ib.product_id=v_product AND ib.status='available'
  WHERE p.id = v_source.pallet_id ORDER BY coalesce(ib.received_at, ib.created_at) LIMIT 1;
  RETURN jsonb_build_object('source', v_result, 'destination', (SELECT code FROM public.locations WHERE id=v_target),
    'replenishment', CASE WHEN v_open.id IS NULL THEN null ELSE jsonb_build_object('id', v_open.id, 'task_number', v_open.task_number, 'status', v_open.status) END);
END;
$$;
REVOKE ALL ON FUNCTION public.trip_pick_reserve(uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_pick_reserve(uuid, boolean, uuid) TO authenticated, service_role;