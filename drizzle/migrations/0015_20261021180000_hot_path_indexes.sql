-- Additive indexes for hot queries found in pg_stat_statements (sandbox, 2026-10-21).
-- Not added, already covered: inventory_balances(pallet_id) has a UNIQUE constraint,
-- app_client_heartbeat(device_id, user_id) is the primary key.

-- products: WHERE active = $1 ORDER BY id (catalog load, ~5.5k rows)
create index if not exists idx_products_active_id on public.products (active, id);

-- putaway_tasks: WHERE status = ANY(...) ORDER BY created_at DESC
create index if not exists idx_putaway_tasks_status_created_at
  on public.putaway_tasks (status, created_at desc);

-- putaway_tasks: pallet lookups and FK cascade checks
create index if not exists idx_putaway_tasks_pallet_id on public.putaway_tasks (pallet_id);
