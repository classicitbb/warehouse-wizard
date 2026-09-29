create or replace function public.dashboard_metrics_summary(p_warehouse_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with live as (
  select * from public.inventory_balances
  where status is null or lower(status::text) not in ('picked','shipped','in_transit','missing')
),
scoped_live as (
  select * from live where p_warehouse_id is not null and warehouse_id = p_warehouse_id
),
recent_audit as (
  select warehouse_id from public.audit_events order by created_at desc limit 50
)
select jsonb_build_object(
  'totalPallets', (select count(*) from live),
  'totalPalletCapacity', (select coalesce(sum(coalesce(max_pallets,0)),0) from public.locations),
  'warehousePallets', (select count(*) from scoped_live),
  'warehousePalletCapacity', (select coalesce(sum(coalesce(max_pallets,0)),0) from public.locations
     where p_warehouse_id is not null and warehouse_id = p_warehouse_id),
  'availablePallets', (select count(*) from public.inventory_balances b
        where (p_warehouse_id is null or b.warehouse_id = p_warehouse_id) and b.status::text = 'available'),
  'coolZoneOccupancy', (select count(*) from live b
        where (p_warehouse_id is null or b.warehouse_id = p_warehouse_id) and b.zone_id is not null),
  'holdStock', (select count(*) from public.inventory_balances b
        where (p_warehouse_id is null or b.warehouse_id = p_warehouse_id) and b.status::text = 'hold'),
  'quarantineStock', (select count(*) from public.inventory_balances b
        where (p_warehouse_id is null or b.warehouse_id = p_warehouse_id) and b.status::text = 'quarantine'),
  'expiryWarning30', (select count(*) from live b where (p_warehouse_id is null or b.warehouse_id = p_warehouse_id)
          and b.expiry_date is not null and b.expiry_date >= current_date
          and b.expiry_date <= current_date + 30),
  'expiryWarning60', (select count(*) from live b where (p_warehouse_id is null or b.warehouse_id = p_warehouse_id)
          and b.expiry_date is not null and b.expiry_date >= current_date
          and b.expiry_date <= current_date + 60),
  'stockAge3Months', (select count(*) from live b where (p_warehouse_id is null or b.warehouse_id = p_warehouse_id)
          and coalesce(b.received_at, b.created_at) <= now() - interval '90 days'),
  'stockAge6Months', (select count(*) from live b where (p_warehouse_id is null or b.warehouse_id = p_warehouse_id)
          and coalesce(b.received_at, b.created_at) <= now() - interval '180 days'),
  'stockAge12Months', (select count(*) from live b where (p_warehouse_id is null or b.warehouse_id = p_warehouse_id)
          and coalesce(b.received_at, b.created_at) <= now() - interval '365 days'),
  'recentAuditEvents', (select count(*) from recent_audit
        where p_warehouse_id is null or warehouse_id = p_warehouse_id),

  'openReceipts', (select count(*) from public.receipts r
        where r.status::text = 'draft' and (p_warehouse_id is null or r.warehouse_id = p_warehouse_id)),
  'openPutawayTasks', (select count(*) from public.putaway_tasks t
        where t.status::text in ('queued','assigned','in_progress','exception')
          and (p_warehouse_id is null or t.warehouse_id = p_warehouse_id)),
  'openPickLists', (select count(*) from public.pick_lists t
        where t.status::text in ('draft','queued','assigned','in_progress','exception')
          and (p_warehouse_id is null or t.warehouse_id = p_warehouse_id)),
  'openMoveTasks', (select count(*) from public.move_tasks t
        where t.status::text in ('queued','assigned','in_progress','exception')
          and (p_warehouse_id is null or t.warehouse_id = p_warehouse_id)),
  'openTransfers', (select count(*) from public.transfers t
        where t.status::text in ('draft','queued','assigned','in_progress','exception')
          and (p_warehouse_id is null or t.source_warehouse_id = p_warehouse_id or t.destination_warehouse_id = p_warehouse_id)),
  'openCycleCounts', (select count(*) from public.cycle_counts t
        where t.status::text in ('draft','frozen','counting','review','approved')
          and (p_warehouse_id is null or t.warehouse_id = p_warehouse_id)),
  'openDockLoads', (select count(*) from public.staging_loads s
        left join public.pick_lists pl on pl.id = s.pick_list_id
        where s.status::text in ('ready','called','loading','blocked')
          and (p_warehouse_id is null or pl.warehouse_id = p_warehouse_id)),
  'openReplenishmentTasks', (select count(*) from public.replenishment_tasks t
        where t.status::text in ('queued','assigned','in_progress','exception')
          and (p_warehouse_id is null or t.warehouse_id = p_warehouse_id)),

  'receiptRows', coalesce((select jsonb_agg(x order by x->>'createdAt')
        from (select jsonb_build_object('id', r.id, 'label', r.receipt_number,
                'sublabel', coalesce(r.reference_number, r.receipt_number),
                'route', '/receiving', 'createdAt', r.created_at) as x
              from public.receipts r
              where r.status::text = 'draft'
                and (p_warehouse_id is null or r.warehouse_id = p_warehouse_id)
              order by r.created_at limit 100) t), '[]'::jsonb),
  'putawayTaskRows', coalesce((select jsonb_agg(x order by x->>'createdAt')
        from (select jsonb_build_object('id', t.id, 'label', t.task_number, 'sublabel', t.status::text,
                'route', '/putaway-tasks', 'createdAt', t.created_at) as x
              from public.putaway_tasks t
              where t.status::text in ('queued','assigned','in_progress','exception')
                and (p_warehouse_id is null or t.warehouse_id = p_warehouse_id)
              order by t.created_at limit 100) t), '[]'::jsonb),
  'pickListRows', coalesce((select jsonb_agg(x order by x->>'createdAt')
        from (select jsonb_build_object('id', t.id, 'label', t.pick_list_number, 'sublabel', t.status::text,
                'route', '/pick-lists', 'createdAt', t.created_at) as x
              from public.pick_lists t
              where t.status::text in ('draft','queued','assigned','in_progress','exception')
                and (p_warehouse_id is null or t.warehouse_id = p_warehouse_id)
              order by t.created_at limit 100) t), '[]'::jsonb),
  'moveTaskRows', coalesce((select jsonb_agg(x order by x->>'createdAt')
        from (select jsonb_build_object('id', t.id, 'label', t.task_number, 'sublabel', t.status::text,
                'route', '/location-moves', 'createdAt', t.created_at) as x
              from public.move_tasks t
              where t.status::text in ('queued','assigned','in_progress','exception')
                and (p_warehouse_id is null or t.warehouse_id = p_warehouse_id)
              order by t.created_at limit 100) t), '[]'::jsonb),
  'transferRows', coalesce((select jsonb_agg(x order by x->>'createdAt')
        from (select jsonb_build_object('id', t.id, 'label', t.transfer_number, 'sublabel', t.status::text,
                'route', '/transfers', 'createdAt', t.created_at) as x
              from public.transfers t
              where t.status::text in ('draft','queued','assigned','in_progress','exception')
                and (p_warehouse_id is null or t.source_warehouse_id = p_warehouse_id or t.destination_warehouse_id = p_warehouse_id)
              order by t.created_at limit 100) t), '[]'::jsonb),
  'cycleCountRows', coalesce((select jsonb_agg(x order by x->>'createdAt')
        from (select jsonb_build_object('id', t.id, 'label', t.count_number, 'sublabel', t.status::text,
                'route', '/cycle-counts', 'createdAt', t.created_at) as x
              from public.cycle_counts t
              where t.status::text in ('draft','frozen','counting','review','approved')
                and (p_warehouse_id is null or t.warehouse_id = p_warehouse_id)
              order by t.created_at limit 100) t), '[]'::jsonb),
  'dockLoadRows', coalesce((select jsonb_agg(x order by x->>'createdAt')
        from (select jsonb_build_object('id', s.id, 'label', s.route_code, 'sublabel', s.status::text,
                'route', '/pick-lists', 'createdAt', s.created_at) as x
              from public.staging_loads s
              left join public.pick_lists pl on pl.id = s.pick_list_id
              where s.status::text in ('ready','called','loading','blocked')
                and (p_warehouse_id is null or pl.warehouse_id = p_warehouse_id)
              order by s.created_at limit 100) t), '[]'::jsonb),
  'replenishmentRows', coalesce((select jsonb_agg(x order by x->>'createdAt')
        from (select jsonb_build_object('id', t.id, 'label', t.task_number, 'sublabel', t.status::text,
                'route', '/inventory-search', 'createdAt', t.created_at) as x
              from public.replenishment_tasks t
              where t.status::text in ('queued','assigned','in_progress','exception')
                and (p_warehouse_id is null or t.warehouse_id = p_warehouse_id)
              order by t.created_at limit 100) t), '[]'::jsonb),
  'blockedBalanceRows', coalesce((select jsonb_agg(x order by x->>'createdAt')
        from (select jsonb_build_object('id', b.id, 'label', upper(left(b.pallet_id::text, 8)),
                'sublabel', b.status::text, 'route', '/status', 'createdAt', b.created_at) as x
              from public.inventory_balances b
              where b.status::text in ('hold','quarantine')
                and (p_warehouse_id is null or b.warehouse_id = p_warehouse_id)
              order by b.created_at limit 100) t), '[]'::jsonb)
)
$$;

grant execute on function public.dashboard_metrics_summary(uuid) to authenticated;
revoke execute on function public.dashboard_metrics_summary(uuid) from anon;