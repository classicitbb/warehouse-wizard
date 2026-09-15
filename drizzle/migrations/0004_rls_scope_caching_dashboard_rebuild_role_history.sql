-- 1. Cached permission scopes -------------------------------------------------
CREATE OR REPLACE FUNCTION public.accessible_warehouse_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.has_unrestricted_warehouse_access() THEN NULL::uuid[]
    ELSE COALESCE((
      SELECT array_agg(DISTINCT ur.warehouse_id)
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.is_hidden = false
        AND ur.warehouse_id IS NOT NULL
    ), '{}'::uuid[])
  END;
$$;

CREATE OR REPLACE FUNCTION public.accessible_transfer_pallet_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT array_agg(DISTINCT tl.pallet_id)
    FROM public.transfer_lines tl
    JOIN public.transfers t ON t.id = tl.transfer_id
    WHERE t.status = 'in_progress'
      AND tl.pallet_id IS NOT NULL
      AND (
        public.can_access_warehouse(t.source_warehouse_id)
        OR public.can_access_warehouse(t.destination_warehouse_id)
      )
  ), '{}'::uuid[]);
$$;

GRANT EXECUTE ON FUNCTION public.accessible_warehouse_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accessible_transfer_pallet_ids() TO authenticated, service_role;

-- 2. Policies rewritten to evaluate scopes once per statement -----------------

-- locations
DROP POLICY IF EXISTS "Scoped read locations" ON public.locations;
CREATE POLICY "Scoped read locations" ON public.locations FOR SELECT TO authenticated
USING (
  (SELECT public.is_approved())
  AND (
    warehouse_id IS NULL
    OR COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
  )
);
DROP POLICY IF EXISTS "Managers update locations" ON public.locations;
CREATE POLICY "Managers update locations" ON public.locations FOR UPDATE TO authenticated
USING ((SELECT public.is_approved()) AND (SELECT public.has_min_role(auth.uid(), 'warehouse_manager')))
WITH CHECK ((SELECT public.is_approved()) AND (SELECT public.has_min_role(auth.uid(), 'warehouse_manager')));
DROP POLICY IF EXISTS "Managers delete locations" ON public.locations;
CREATE POLICY "Managers delete locations" ON public.locations FOR DELETE TO authenticated
USING ((SELECT public.is_approved()) AND (SELECT public.has_min_role(auth.uid(), 'warehouse_manager')));
DROP POLICY IF EXISTS "Managers write locations" ON public.locations;
CREATE POLICY "Managers write locations" ON public.locations FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_approved()) AND (SELECT public.has_min_role(auth.uid(), 'warehouse_manager')));

-- products
DROP POLICY IF EXISTS "Approved users can read products" ON public.products;
CREATE POLICY "Approved users can read products" ON public.products FOR SELECT TO authenticated
USING ((SELECT public.is_approved()));
DROP POLICY IF EXISTS "Managers update products" ON public.products;
CREATE POLICY "Managers update products" ON public.products FOR UPDATE TO authenticated
USING ((SELECT public.is_approved()) AND (SELECT public.has_min_role(auth.uid(), 'warehouse_manager')))
WITH CHECK ((SELECT public.is_approved()) AND (SELECT public.has_min_role(auth.uid(), 'warehouse_manager')));
DROP POLICY IF EXISTS "Managers delete products" ON public.products;
CREATE POLICY "Managers delete products" ON public.products FOR DELETE TO authenticated
USING ((SELECT public.is_approved()) AND (SELECT public.has_min_role(auth.uid(), 'warehouse_manager')));
DROP POLICY IF EXISTS "Managers write products" ON public.products;
CREATE POLICY "Managers write products" ON public.products FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_approved()) AND (SELECT public.has_min_role(auth.uid(), 'warehouse_manager')));

-- audit_events
DROP POLICY IF EXISTS "Approved users can read audit_events" ON public.audit_events;
CREATE POLICY "Approved users can read audit_events" ON public.audit_events FOR SELECT TO authenticated
USING (
  (SELECT public.is_approved())
  AND (
    warehouse_id IS NULL
    OR COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
  )
);
DROP POLICY IF EXISTS "Admins update audit_events" ON public.audit_events;
CREATE POLICY "Admins update audit_events" ON public.audit_events FOR UPDATE TO authenticated
USING ((SELECT public.is_approved()) AND (SELECT public.has_min_role(auth.uid(), 'admin')))
WITH CHECK ((SELECT public.is_approved()) AND (SELECT public.has_min_role(auth.uid(), 'admin')));
DROP POLICY IF EXISTS "Admins delete audit_events" ON public.audit_events;
CREATE POLICY "Admins delete audit_events" ON public.audit_events FOR DELETE TO authenticated
USING ((SELECT public.is_approved()) AND (SELECT public.has_min_role(auth.uid(), 'admin')));
DROP POLICY IF EXISTS "Admins write audit_events" ON public.audit_events;
CREATE POLICY "Admins write audit_events" ON public.audit_events FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_approved()) AND (SELECT public.has_min_role(auth.uid(), 'admin')));

-- receipts
DROP POLICY IF EXISTS "Scoped read receipts" ON public.receipts;
CREATE POLICY "Scoped read receipts" ON public.receipts FOR SELECT TO authenticated
USING (
  (SELECT public.is_approved())
  AND (
    warehouse_id IS NULL
    OR COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
  )
);
DROP POLICY IF EXISTS "Scoped update receipts" ON public.receipts;
CREATE POLICY "Scoped update receipts" ON public.receipts FOR UPDATE TO authenticated
USING (
  (SELECT public.is_approved())
  AND (warehouse_id IS NULL OR COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true))
)
WITH CHECK (
  (SELECT public.is_approved())
  AND (warehouse_id IS NULL OR COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true))
);
DROP POLICY IF EXISTS "Scoped insert receipts" ON public.receipts;
CREATE POLICY "Scoped insert receipts" ON public.receipts FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_approved())
  AND (warehouse_id IS NULL OR COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true))
);
DROP POLICY IF EXISTS "Scoped delete receipts" ON public.receipts;
CREATE POLICY "Scoped delete receipts" ON public.receipts FOR DELETE TO authenticated
USING (
  (SELECT public.is_approved())
  AND (warehouse_id IS NULL OR COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true))
);

-- inventory_balances
DROP POLICY IF EXISTS "Scoped read inventory_balances" ON public.inventory_balances;
CREATE POLICY "Scoped read inventory_balances" ON public.inventory_balances FOR SELECT TO authenticated
USING (
  (SELECT public.is_approved())
  AND (
    COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
    OR pallet_id = ANY ((SELECT public.accessible_transfer_pallet_ids())::uuid[])
  )
);
DROP POLICY IF EXISTS "Scoped update inventory_balances" ON public.inventory_balances;
CREATE POLICY "Scoped update inventory_balances" ON public.inventory_balances FOR UPDATE TO authenticated
USING (
  (SELECT public.is_approved())
  AND (
    COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
    OR pallet_id = ANY ((SELECT public.accessible_transfer_pallet_ids())::uuid[])
  )
)
WITH CHECK (
  (SELECT public.is_approved())
  AND COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
);
DROP POLICY IF EXISTS "Scoped insert inventory_balances" ON public.inventory_balances;
CREATE POLICY "Scoped insert inventory_balances" ON public.inventory_balances FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_approved())
  AND COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
);
DROP POLICY IF EXISTS "Managers delete inventory_balances" ON public.inventory_balances;
CREATE POLICY "Managers delete inventory_balances" ON public.inventory_balances FOR DELETE TO authenticated
USING (
  (SELECT public.is_approved())
  AND (SELECT public.has_min_role(auth.uid(), 'warehouse_manager'))
  AND COALESCE(warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
);

-- pallets
DROP POLICY IF EXISTS "Scoped read pallets" ON public.pallets;
CREATE POLICY "Scoped read pallets" ON public.pallets FOR SELECT TO authenticated
USING (
  (SELECT public.is_approved())
  AND (
    COALESCE(current_warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
    OR id = ANY ((SELECT public.accessible_transfer_pallet_ids())::uuid[])
  )
);
DROP POLICY IF EXISTS "Scoped update pallets" ON public.pallets;
CREATE POLICY "Scoped update pallets" ON public.pallets FOR UPDATE TO authenticated
USING (
  (SELECT public.is_approved())
  AND (
    COALESCE(current_warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
    OR id = ANY ((SELECT public.accessible_transfer_pallet_ids())::uuid[])
  )
)
WITH CHECK (
  (SELECT public.is_approved())
  AND COALESCE(current_warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
);
DROP POLICY IF EXISTS "Scoped insert pallets" ON public.pallets;
CREATE POLICY "Scoped insert pallets" ON public.pallets FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_approved())
  AND COALESCE(current_warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
);
DROP POLICY IF EXISTS "Managers delete pallets" ON public.pallets;
CREATE POLICY "Managers delete pallets" ON public.pallets FOR DELETE TO authenticated
USING (
  (SELECT public.is_approved())
  AND (SELECT public.has_min_role(auth.uid(), 'warehouse_manager'))
  AND (
    COALESCE(current_warehouse_id = ANY ((SELECT public.accessible_warehouse_ids())::uuid[]), true)
    OR id = ANY ((SELECT public.accessible_transfer_pallet_ids())::uuid[])
  )
);

-- 3. Indexes for the hot list reads -----------------------------------------
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON public.audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_warehouse_created_idx ON public.audit_events (warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pallets_warehouse_status_idx ON public.pallets (current_warehouse_id, status);
CREATE INDEX IF NOT EXISTS receipts_warehouse_status_created_idx ON public.receipts (warehouse_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS user_roles_active_user_idx ON public.user_roles (user_id) WHERE is_hidden = false;

-- 4. Command Center summary: one pass per table, no per-row policy cost ------
CREATE OR REPLACE FUNCTION public.dashboard_metrics_summary(p_warehouse_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_scope uuid[];
  v_stock jsonb;
BEGIN
  IF NOT public.is_approved() THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  IF p_warehouse_id IS NOT NULL THEN
    IF NOT public.can_access_warehouse(p_warehouse_id) THEN
      RAISE EXCEPTION 'Not authorised for this warehouse';
    END IF;
    v_scope := ARRAY[p_warehouse_id];
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

-- 5. Role assignment history -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_role_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_role_id uuid,
  user_id uuid NOT NULL,
  role_id uuid,
  role_code text,
  warehouse_id uuid,
  action text NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_role_events_user_created_idx ON public.user_role_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_role_events_created_idx ON public.user_role_events (created_at DESC);

GRANT SELECT ON public.user_role_events TO authenticated;
GRANT ALL ON public.user_role_events TO service_role;

ALTER TABLE public.user_role_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisors read user_role_events" ON public.user_role_events;
CREATE POLICY "Supervisors read user_role_events" ON public.user_role_events FOR SELECT TO authenticated
USING ((SELECT public.is_approved()) AND (SELECT public.has_min_role(auth.uid(), 'warehouse_supervisor')));

CREATE OR REPLACE FUNCTION public.log_user_role_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_action text;
  v_row public.user_roles;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := CASE WHEN coalesce(NEW.is_hidden, false) THEN 'archived' ELSE 'assigned' END;
    v_row := NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'removed';
    v_row := OLD;
  ELSE
    v_row := NEW;
    IF coalesce(OLD.is_hidden, false) IS DISTINCT FROM coalesce(NEW.is_hidden, false) THEN
      v_action := CASE WHEN coalesce(NEW.is_hidden, false) THEN 'archived' ELSE 'unarchived' END;
    ELSIF OLD.warehouse_id IS DISTINCT FROM NEW.warehouse_id THEN
      v_action := 'warehouse_changed';
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.user_role_events
    (user_role_id, user_id, role_id, role_code, warehouse_id, action, actor_id)
  VALUES (
    v_row.id,
    v_row.user_id,
    v_row.role_id,
    (SELECT r.code::text FROM public.roles r WHERE r.id = v_row.role_id),
    v_row.warehouse_id,
    v_action,
    auth.uid()
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS user_roles_history_trg ON public.user_roles;
CREATE TRIGGER user_roles_history_trg
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.log_user_role_event();

ANALYZE public.inventory_balances;
ANALYZE public.locations;
ANALYZE public.audit_events;
ANALYZE public.products;
ANALYZE public.pallets;
ANALYZE public.receipts;