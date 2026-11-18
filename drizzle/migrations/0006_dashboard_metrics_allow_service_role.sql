-- Keep the authorisation gate for signed-in callers, but allow trusted
-- server-side callers (service role / no JWT) to read every warehouse.
CREATE OR REPLACE FUNCTION public.dashboard_metrics_summary(p_warehouse_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_scope uuid[];
  v_stock jsonb;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NOT NULL AND NOT public.is_approved() THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  IF p_warehouse_id IS NOT NULL THEN
    IF v_uid IS NOT NULL AND NOT public.can_access_warehouse(p_warehouse_id) THEN
      RAISE EXCEPTION 'Not authorised for this warehouse';
    END IF;
    v_scope := ARRAY[p_warehouse_id];
  ELSIF v_uid IS NULL THEN
    v_scope := NULL;
  ELSE
    v_scope := public.accessible_warehouse_ids();
  END IF;

  SELECT jsonb_build_object(
    'totalPallets', count(*) FILTER (WHERE b.live),
    'availablePallets', count(*) FILTER (WHERE b.status_text = 'available'),
    'coolZoneOccupancy', count(*) FILTER (WHERE b.live AND b.zone_id IS NOT NULL),
    'holdStock', count(*) FILTER (WHERE b.status_text = 'hold'),
    'quarantineStock', count(*) FILTER (WHERE b.status_text = 'quarantine'),
    'expiryWarning30', count(*) FILTER (
      WHERE b.live AND b.expiry_date IS NOT NULL
        AND b.expiry_date >= current_date AND b.expiry_date <= current_date + 30),
    'expiryWarning60', count(*) FILTER (
      WHERE b.live AND b.expiry_date IS NOT NULL
        AND b.expiry_date >= current_date AND b.expiry_date <= current_date + 60),
    'stockAge3Months', count(*) FILTER (WHERE b.live AND b.aged_at <= now() - interval '90 days'),
    'stockAge6Months', count(*) FILTER (WHERE b.live AND b.aged_at <= now() - interval '180 days'),
    'stockAge12Months', count(*) FILTER (WHERE b.live AND b.aged_at <= now() - interval '365 days'),
    'warehousePallets', count(*) FILTER (
      WHERE b.live AND p_warehouse_id IS NOT NULL AND b.warehouse_id = p_warehouse_id)
  )
  INTO v_stock
  FROM (
    SELECT
      ib.warehouse_id,
      ib.zone_id,
      ib.expiry_date,
      lower(ib.status::text) AS status_text,
      coalesce(ib.received_at, ib.created_at) AS aged_at,
      (ib.status IS NULL
        OR lower(ib.status::text) NOT IN ('picked','shipped','in_transit','missing')) AS live
    FROM public.inventory_balances ib
    WHERE v_scope IS NULL OR ib.warehouse_id = ANY (v_scope)
  ) b;

  RETURN coalesce(v_stock, '{}'::jsonb) || jsonb_build_object(
    'totalPalletCapacity', (SELECT coalesce(sum(coalesce(l.max_pallets, 0)), 0) FROM public.locations l
        WHERE v_scope IS NULL OR l.warehouse_id = ANY (v_scope)),
    'warehousePalletCapacity', (SELECT coalesce(sum(coalesce(l.max_pallets, 0)), 0) FROM public.locations l
        WHERE p_warehouse_id IS NOT NULL AND l.warehouse_id = p_warehouse_id),
    'recentAuditEvents', (SELECT count(*) FROM (
          SELECT a.warehouse_id FROM public.audit_events a ORDER BY a.created_at DESC LIMIT 50
        ) ra WHERE v_scope IS NULL OR ra.warehouse_id = ANY (v_scope)),

    'openReceipts', (SELECT count(*) FROM public.receipts r
        WHERE r.status::text = 'draft' AND (v_scope IS NULL OR r.warehouse_id = ANY (v_scope))),
    'openPutawayTasks', (SELECT count(*) FROM public.putaway_tasks t
        WHERE t.status::text IN ('queued','assigned','in_progress','exception')
          AND (v_scope IS NULL OR t.warehouse_id = ANY (v_scope))),
    'openPickLists', (SELECT count(*) FROM public.pick_lists t
        WHERE t.status::text IN ('draft','queued','assigned','in_progress','exception')
          AND (v_scope IS NULL OR t.warehouse_id = ANY (v_scope))),
    'openMoveTasks', (SELECT count(*) FROM public.move_tasks t
        WHERE t.status::text IN ('queued','assigned','in_progress','exception')
          AND (v_scope IS NULL OR t.warehouse_id = ANY (v_scope))),
    'openTransfers', (SELECT count(*) FROM public.transfers t
        WHERE t.status::text IN ('draft','queued','assigned','in_progress','exception')
          AND (v_scope IS NULL OR t.source_warehouse_id = ANY (v_scope) OR t.destination_warehouse_id = ANY (v_scope))),
    'openCycleCounts', (SELECT count(*) FROM public.cycle_counts t
        WHERE t.status::text IN ('draft','frozen','counting','review','approved')
          AND (v_scope IS NULL OR t.warehouse_id = ANY (v_scope))),
    'openDockLoads', (SELECT count(*) FROM public.staging_loads s
        LEFT JOIN public.pick_lists pl ON pl.id = s.pick_list_id
        WHERE s.status::text IN ('ready','called','loading','blocked')
          AND (v_scope IS NULL OR pl.warehouse_id = ANY (v_scope))),
    'openReplenishmentTasks', (SELECT count(*) FROM public.replenishment_tasks t
        WHERE t.status::text IN ('queued','assigned','in_progress','exception')
          AND (v_scope IS NULL OR t.warehouse_id = ANY (v_scope))),

    'receiptRows', coalesce((SELECT jsonb_agg(x ORDER BY x->>'createdAt') FROM (
          SELECT jsonb_build_object('id', r.id, 'label', r.receipt_number,
            'sublabel', coalesce(r.reference_number, r.receipt_number),
            'route', '/receiving', 'createdAt', r.created_at) AS x
          FROM public.receipts r
          WHERE r.status::text = 'draft' AND (v_scope IS NULL OR r.warehouse_id = ANY (v_scope))
          ORDER BY r.created_at LIMIT 100) t), '[]'::jsonb),
    'putawayTaskRows', coalesce((SELECT jsonb_agg(x ORDER BY x->>'createdAt') FROM (
          SELECT jsonb_build_object('id', t.id, 'label', t.task_number, 'sublabel', t.status::text,
            'route', '/putaway-tasks', 'createdAt', t.created_at) AS x
          FROM public.putaway_tasks t
          WHERE t.status::text IN ('queued','assigned','in_progress','exception')
            AND (v_scope IS NULL OR t.warehouse_id = ANY (v_scope))
          ORDER BY t.created_at LIMIT 100) t), '[]'::jsonb),
    'pickListRows', coalesce((SELECT jsonb_agg(x ORDER BY x->>'createdAt') FROM (
          SELECT jsonb_build_object('id', t.id, 'label', t.pick_list_number, 'sublabel', t.status::text,
            'route', '/pick-lists', 'createdAt', t.created_at) AS x
          FROM public.pick_lists t
          WHERE t.status::text IN ('draft','queued','assigned','in_progress','exception')
            AND (v_scope IS NULL OR t.warehouse_id = ANY (v_scope))
          ORDER BY t.created_at LIMIT 100) t), '[]'::jsonb),
    'moveTaskRows', coalesce((SELECT jsonb_agg(x ORDER BY x->>'createdAt') FROM (
          SELECT jsonb_build_object('id', t.id, 'label', t.task_number, 'sublabel', t.status::text,
            'route', '/location-moves', 'createdAt', t.created_at) AS x
          FROM public.move_tasks t
          WHERE t.status::text IN ('queued','assigned','in_progress','exception')
            AND (v_scope IS NULL OR t.warehouse_id = ANY (v_scope))
          ORDER BY t.created_at LIMIT 100) t), '[]'::jsonb),
    'transferRows', coalesce((SELECT jsonb_agg(x ORDER BY x->>'createdAt') FROM (
          SELECT jsonb_build_object('id', t.id, 'label', t.transfer_number, 'sublabel', t.status::text,
            'route', '/transfers', 'createdAt', t.created_at) AS x
          FROM public.transfers t
          WHERE t.status::text IN ('draft','queued','assigned','in_progress','exception')
            AND (v_scope IS NULL OR t.source_warehouse_id = ANY (v_scope) OR t.destination_warehouse_id = ANY (v_scope))
          ORDER BY t.created_at LIMIT 100) t), '[]'::jsonb),
    'cycleCountRows', coalesce((SELECT jsonb_agg(x ORDER BY x->>'createdAt') FROM (
          SELECT jsonb_build_object('id', t.id, 'label', t.count_number, 'sublabel', t.status::text,
            'route', '/cycle-counts', 'createdAt', t.created_at) AS x
          FROM public.cycle_counts t
          WHERE t.status::text IN ('draft','frozen','counting','review','approved')
            AND (v_scope IS NULL OR t.warehouse_id = ANY (v_scope))
          ORDER BY t.created_at LIMIT 100) t), '[]'::jsonb),
    'dockLoadRows', coalesce((SELECT jsonb_agg(x ORDER BY x->>'createdAt') FROM (
          SELECT jsonb_build_object('id', s.id, 'label', s.route_code, 'sublabel', s.status::text,
            'route', '/pick-lists', 'createdAt', s.created_at) AS x
          FROM public.staging_loads s
          LEFT JOIN public.pick_lists pl ON pl.id = s.pick_list_id
          WHERE s.status::text IN ('ready','called','loading','blocked')
            AND (v_scope IS NULL OR pl.warehouse_id = ANY (v_scope))
          ORDER BY s.created_at LIMIT 100) t), '[]'::jsonb),
    'replenishmentRows', coalesce((SELECT jsonb_agg(x ORDER BY x->>'createdAt') FROM (
          SELECT jsonb_build_object('id', t.id, 'label', t.task_number, 'sublabel', t.status::text,
            'route', '/inventory-search', 'createdAt', t.created_at) AS x
          FROM public.replenishment_tasks t
          WHERE t.status::text IN ('queued','assigned','in_progress','exception')
            AND (v_scope IS NULL OR t.warehouse_id = ANY (v_scope))
          ORDER BY t.created_at LIMIT 100) t), '[]'::jsonb),
    'blockedBalanceRows', coalesce((SELECT jsonb_agg(x ORDER BY x->>'createdAt') FROM (
          SELECT jsonb_build_object('id', b.id, 'label', upper(left(b.pallet_id::text, 8)),
            'sublabel', b.status::text, 'route', '/status', 'createdAt', b.created_at) AS x
          FROM public.inventory_balances b
          WHERE b.status::text IN ('hold','quarantine')
            AND (v_scope IS NULL OR b.warehouse_id = ANY (v_scope))
          ORDER BY b.created_at LIMIT 100) t), '[]'::jsonb)
  );
END
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_metrics_summary(uuid) TO authenticated, service_role;