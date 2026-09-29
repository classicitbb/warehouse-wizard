-- Security hardening pass:
--   1. Warehouse-scoped RLS for operational WMS tables, based on the existing
--      per-role warehouse assignment (user_roles.warehouse_id). A user_roles
--      row with warehouse_id IS NULL is "unrestricted" (sees/edits every
--      warehouse) -- this already matches how admin/global roles are granted
--      via the invite flow. A row with warehouse_id set only grants access to
--      that warehouse.
--   2. Role enforcement for destructive actions: any approved user (including
--      warehouse_operator/dispatch_driver) could previously delete orders,
--      pallets, receipts, stock adjustments, and other operational records.
--      Deletes on those tables now require warehouse_manager tier or above
--      (uses the existing public.has_min_role helper introduced for cycle
--      counts). Master-data tables (warehouses/zones/locations/clients/
--      products/packaging profiles) get the same tier requirement for
--      insert/update/delete; reads stay open to any approved user.
--   3. Storage buckets (labels/imports/attachments) required only a valid
--      session, not is_approved() -- brought in line with every other policy.
--   4. Swept every SECURITY DEFINER function exposed in the public schema and
--      revoked anon/public execute by default, keeping only the explicit
--      pre-auth login-resolution RPC public.
--
-- Client-level data isolation is intentionally NOT part of this migration --
-- there is no user-to-client assignment concept anywhere in the schema, and
-- this app's staff routinely work across every client stored in a warehouse
-- they can access. Scoping by warehouse is the real security boundary here.

-- ============================================================
-- 1. WAREHOUSE-SCOPING HELPER FUNCTIONS
-- ============================================================

create or replace function public.has_unrestricted_warehouse_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.warehouse_id is null
      and ur.is_hidden = false
  );
$$;

create or replace function public.can_access_warehouse(target_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_warehouse_id is null
     or public.has_unrestricted_warehouse_access()
     or exists (
       select 1
       from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.warehouse_id = target_warehouse_id
         and ur.is_hidden = false
     );
$$;

-- A pallet that is mid-transfer (transfers.status = 'in_progress') is still
-- tagged with its source warehouse until receiveTransfer() flips
-- pallets.current_warehouse_id to the destination. Without this, a clerk
-- scoped only to the destination warehouse could not see or receive it.
create or replace function public.pallet_in_accessible_transfer(target_pallet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.transfer_lines tl
    join public.transfers t on t.id = tl.transfer_id
    where tl.pallet_id = target_pallet_id
      and t.status = 'in_progress'
      and (
        public.can_access_warehouse(t.source_warehouse_id)
        or public.can_access_warehouse(t.destination_warehouse_id)
      )
  );
$$;

revoke execute on function public.has_unrestricted_warehouse_access() from anon, public;
revoke execute on function public.can_access_warehouse(uuid) from anon, public;
revoke execute on function public.pallet_in_accessible_transfer(uuid) from anon, public;
grant execute on function public.has_unrestricted_warehouse_access() to authenticated;
grant execute on function public.can_access_warehouse(uuid) to authenticated;
grant execute on function public.pallet_in_accessible_transfer(uuid) to authenticated;

-- ============================================================
-- 2. MASTER DATA: reads stay open to any approved user, writes
--    require warehouse_manager tier (admin/developer inherit via rank).
-- ============================================================
do $$
declare
  t text;
  master_tables text[] := array['warehouses', 'clients', 'products', 'product_packaging_profiles'];
  pol record;
begin
  foreach t in array master_tables loop
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname in (
          format('Approved users can insert %s', t),
          format('Approved users can update %s', t),
          format('Approved users can delete %s', t)
        )
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;

    execute format(
      'create policy "Managers write %I" on public.%I for insert to authenticated with check (public.is_approved() and public.has_min_role(auth.uid(), ''warehouse_manager''))',
      t, t
    );
    execute format(
      'create policy "Managers update %I" on public.%I for update to authenticated using (public.is_approved() and public.has_min_role(auth.uid(), ''warehouse_manager'')) with check (public.is_approved() and public.has_min_role(auth.uid(), ''warehouse_manager''))',
      t, t
    );
    execute format(
      'create policy "Managers delete %I" on public.%I for delete to authenticated using (public.is_approved() and public.has_min_role(auth.uid(), ''warehouse_manager''))',
      t, t
    );
  end loop;
end $$;

-- ============================================================
-- 3. ZONES / LOCATIONS: reads scoped to accessible warehouses,
--    writes require warehouse_manager tier.
-- ============================================================
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['zones', 'locations'] loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;

    execute format(
      'create policy "Scoped read %I" on public.%I for select to authenticated using (public.is_approved() and public.can_access_warehouse(warehouse_id))',
      t, t
    );
    execute format(
      'create policy "Managers write %I" on public.%I for insert to authenticated with check (public.is_approved() and public.has_min_role(auth.uid(), ''warehouse_manager''))',
      t, t
    );
    execute format(
      'create policy "Managers update %I" on public.%I for update to authenticated using (public.is_approved() and public.has_min_role(auth.uid(), ''warehouse_manager'')) with check (public.is_approved() and public.has_min_role(auth.uid(), ''warehouse_manager''))',
      t, t
    );
    execute format(
      'create policy "Managers delete %I" on public.%I for delete to authenticated using (public.is_approved() and public.has_min_role(auth.uid(), ''warehouse_manager''))',
      t, t
    );
  end loop;
end $$;

-- ============================================================
-- 4. DIRECT-WAREHOUSE OPERATIONAL TABLES
--    (warehouse_id column, not null): putaway_tasks, orders,
--    pick_lists, move_tasks.
-- ============================================================
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['putaway_tasks', 'orders', 'pick_lists', 'move_tasks'] loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;

    execute format(
      'create policy "Scoped read %I" on public.%I for select to authenticated using (public.is_approved() and public.can_access_warehouse(warehouse_id))',
      t, t
    );
    execute format(
      'create policy "Scoped insert %I" on public.%I for insert to authenticated with check (public.is_approved() and public.can_access_warehouse(warehouse_id))',
      t, t
    );
    execute format(
      'create policy "Scoped update %I" on public.%I for update to authenticated using (public.is_approved() and public.can_access_warehouse(warehouse_id)) with check (public.is_approved() and public.can_access_warehouse(warehouse_id))',
      t, t
    );
    execute format(
      'create policy "Managers delete %I" on public.%I for delete to authenticated using (public.is_approved() and public.has_min_role(auth.uid(), ''warehouse_manager'') and public.can_access_warehouse(warehouse_id))',
      t, t
    );
  end loop;
end $$;

-- receipts: same pattern, but deleting a draft receipt is a legitimate
-- clerk/operator action (receiving-core.ts cancels a receipt they just
-- started) -- only non-draft receipts require manager tier to delete.
drop policy if exists "Approved users can read receipts" on public.receipts;
drop policy if exists "Approved users can insert receipts" on public.receipts;
drop policy if exists "Approved users can update receipts" on public.receipts;
drop policy if exists "Approved users can delete receipts" on public.receipts;

create policy "Scoped read receipts"
  on public.receipts for select to authenticated
  using (public.is_approved() and public.can_access_warehouse(warehouse_id));

create policy "Scoped insert receipts"
  on public.receipts for insert to authenticated
  with check (public.is_approved() and public.can_access_warehouse(warehouse_id));

create policy "Scoped update receipts"
  on public.receipts for update to authenticated
  using (public.is_approved() and public.can_access_warehouse(warehouse_id))
  with check (public.is_approved() and public.can_access_warehouse(warehouse_id));

create policy "Scoped delete receipts"
  on public.receipts for delete to authenticated
  using (
    public.is_approved()
    and public.can_access_warehouse(warehouse_id)
    and (status = 'draft' or public.has_min_role(auth.uid(), 'warehouse_manager'))
  );

-- ============================================================
-- 5. PALLETS / INVENTORY_BALANCES: warehouse-scoped, with an
--    exception for pallets/balances mid in-progress transfer.
-- ============================================================
drop policy if exists "Approved users can read pallets" on public.pallets;
drop policy if exists "Approved users can insert pallets" on public.pallets;
drop policy if exists "Approved users can update pallets" on public.pallets;
drop policy if exists "Approved users can delete pallets" on public.pallets;

create policy "Scoped read pallets"
  on public.pallets for select to authenticated
  using (
    public.is_approved()
    and (public.can_access_warehouse(current_warehouse_id) or public.pallet_in_accessible_transfer(id))
  );

create policy "Scoped insert pallets"
  on public.pallets for insert to authenticated
  with check (public.is_approved() and public.can_access_warehouse(current_warehouse_id));

create policy "Scoped update pallets"
  on public.pallets for update to authenticated
  using (
    public.is_approved()
    and (public.can_access_warehouse(current_warehouse_id) or public.pallet_in_accessible_transfer(id))
  )
  with check (public.is_approved() and public.can_access_warehouse(current_warehouse_id));

create policy "Managers delete pallets"
  on public.pallets for delete to authenticated
  using (
    public.is_approved()
    and public.has_min_role(auth.uid(), 'warehouse_manager')
    and (public.can_access_warehouse(current_warehouse_id) or public.pallet_in_accessible_transfer(id))
  );

drop policy if exists "Approved users can read inventory_balances" on public.inventory_balances;
drop policy if exists "Approved users can insert inventory_balances" on public.inventory_balances;
drop policy if exists "Approved users can update inventory_balances" on public.inventory_balances;
drop policy if exists "Approved users can delete inventory_balances" on public.inventory_balances;

create policy "Scoped read inventory_balances"
  on public.inventory_balances for select to authenticated
  using (
    public.is_approved()
    and (public.can_access_warehouse(warehouse_id) or public.pallet_in_accessible_transfer(pallet_id))
  );

create policy "Scoped insert inventory_balances"
  on public.inventory_balances for insert to authenticated
  with check (public.is_approved() and public.can_access_warehouse(warehouse_id));

create policy "Scoped update inventory_balances"
  on public.inventory_balances for update to authenticated
  using (
    public.is_approved()
    and (public.can_access_warehouse(warehouse_id) or public.pallet_in_accessible_transfer(pallet_id))
  )
  with check (public.is_approved() and public.can_access_warehouse(warehouse_id));

create policy "Managers delete inventory_balances"
  on public.inventory_balances for delete to authenticated
  using (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager') and public.can_access_warehouse(warehouse_id));

-- ============================================================
-- 6. TRANSFERS: accessible if either side (source or destination)
--    is an accessible warehouse.
-- ============================================================
drop policy if exists "Approved users can read transfers" on public.transfers;
drop policy if exists "Approved users can insert transfers" on public.transfers;
drop policy if exists "Approved users can update transfers" on public.transfers;
drop policy if exists "Approved users can delete transfers" on public.transfers;

create policy "Scoped read transfers"
  on public.transfers for select to authenticated
  using (
    public.is_approved()
    and (public.can_access_warehouse(source_warehouse_id) or public.can_access_warehouse(destination_warehouse_id))
  );

create policy "Scoped insert transfers"
  on public.transfers for insert to authenticated
  with check (
    public.is_approved()
    and (public.can_access_warehouse(source_warehouse_id) or public.can_access_warehouse(destination_warehouse_id))
  );

create policy "Scoped update transfers"
  on public.transfers for update to authenticated
  using (
    public.is_approved()
    and (public.can_access_warehouse(source_warehouse_id) or public.can_access_warehouse(destination_warehouse_id))
  )
  with check (
    public.is_approved()
    and (public.can_access_warehouse(source_warehouse_id) or public.can_access_warehouse(destination_warehouse_id))
  );

create policy "Managers delete transfers"
  on public.transfers for delete to authenticated
  using (
    public.is_approved()
    and public.has_min_role(auth.uid(), 'warehouse_manager')
    and (public.can_access_warehouse(source_warehouse_id) or public.can_access_warehouse(destination_warehouse_id))
  );

-- ============================================================
-- 7. CHILD TABLES: scoped via their parent's warehouse.
-- ============================================================
drop policy if exists "Approved users can read receipt_lines" on public.receipt_lines;
drop policy if exists "Approved users can insert receipt_lines" on public.receipt_lines;
drop policy if exists "Approved users can update receipt_lines" on public.receipt_lines;
drop policy if exists "Approved users can delete receipt_lines" on public.receipt_lines;

create policy "Scoped read receipt_lines"
  on public.receipt_lines for select to authenticated
  using (public.is_approved() and exists (
    select 1 from public.receipts r where r.id = receipt_lines.receipt_id and public.can_access_warehouse(r.warehouse_id)
  ));
create policy "Scoped insert receipt_lines"
  on public.receipt_lines for insert to authenticated
  with check (public.is_approved() and exists (
    select 1 from public.receipts r where r.id = receipt_lines.receipt_id and public.can_access_warehouse(r.warehouse_id)
  ));
create policy "Scoped update receipt_lines"
  on public.receipt_lines for update to authenticated
  using (public.is_approved() and exists (
    select 1 from public.receipts r where r.id = receipt_lines.receipt_id and public.can_access_warehouse(r.warehouse_id)
  ))
  with check (public.is_approved() and exists (
    select 1 from public.receipts r where r.id = receipt_lines.receipt_id and public.can_access_warehouse(r.warehouse_id)
  ));
create policy "Managers delete receipt_lines"
  on public.receipt_lines for delete to authenticated
  using (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager') and exists (
    select 1 from public.receipts r where r.id = receipt_lines.receipt_id and public.can_access_warehouse(r.warehouse_id)
  ));

drop policy if exists "Approved users can read order_lines" on public.order_lines;
drop policy if exists "Approved users can insert order_lines" on public.order_lines;
drop policy if exists "Approved users can update order_lines" on public.order_lines;
drop policy if exists "Approved users can delete order_lines" on public.order_lines;

create policy "Scoped read order_lines"
  on public.order_lines for select to authenticated
  using (public.is_approved() and exists (
    select 1 from public.orders o where o.id = order_lines.order_id and public.can_access_warehouse(o.warehouse_id)
  ));
create policy "Scoped insert order_lines"
  on public.order_lines for insert to authenticated
  with check (public.is_approved() and exists (
    select 1 from public.orders o where o.id = order_lines.order_id and public.can_access_warehouse(o.warehouse_id)
  ));
create policy "Scoped update order_lines"
  on public.order_lines for update to authenticated
  using (public.is_approved() and exists (
    select 1 from public.orders o where o.id = order_lines.order_id and public.can_access_warehouse(o.warehouse_id)
  ))
  with check (public.is_approved() and exists (
    select 1 from public.orders o where o.id = order_lines.order_id and public.can_access_warehouse(o.warehouse_id)
  ));
create policy "Managers delete order_lines"
  on public.order_lines for delete to authenticated
  using (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager') and exists (
    select 1 from public.orders o where o.id = order_lines.order_id and public.can_access_warehouse(o.warehouse_id)
  ));

drop policy if exists "Approved users can read pick_tasks" on public.pick_tasks;
drop policy if exists "Approved users can insert pick_tasks" on public.pick_tasks;
drop policy if exists "Approved users can update pick_tasks" on public.pick_tasks;
drop policy if exists "Approved users can delete pick_tasks" on public.pick_tasks;

create policy "Scoped read pick_tasks"
  on public.pick_tasks for select to authenticated
  using (public.is_approved() and exists (
    select 1 from public.pick_lists pl where pl.id = pick_tasks.pick_list_id and public.can_access_warehouse(pl.warehouse_id)
  ));
create policy "Scoped insert pick_tasks"
  on public.pick_tasks for insert to authenticated
  with check (public.is_approved() and exists (
    select 1 from public.pick_lists pl where pl.id = pick_tasks.pick_list_id and public.can_access_warehouse(pl.warehouse_id)
  ));
create policy "Scoped update pick_tasks"
  on public.pick_tasks for update to authenticated
  using (public.is_approved() and exists (
    select 1 from public.pick_lists pl where pl.id = pick_tasks.pick_list_id and public.can_access_warehouse(pl.warehouse_id)
  ))
  with check (public.is_approved() and exists (
    select 1 from public.pick_lists pl where pl.id = pick_tasks.pick_list_id and public.can_access_warehouse(pl.warehouse_id)
  ));
create policy "Managers delete pick_tasks"
  on public.pick_tasks for delete to authenticated
  using (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager') and exists (
    select 1 from public.pick_lists pl where pl.id = pick_tasks.pick_list_id and public.can_access_warehouse(pl.warehouse_id)
  ));

drop policy if exists "Approved users can read transfer_lines" on public.transfer_lines;
drop policy if exists "Approved users can insert transfer_lines" on public.transfer_lines;
drop policy if exists "Approved users can update transfer_lines" on public.transfer_lines;
drop policy if exists "Approved users can delete transfer_lines" on public.transfer_lines;

create policy "Scoped read transfer_lines"
  on public.transfer_lines for select to authenticated
  using (public.is_approved() and exists (
    select 1 from public.transfers t where t.id = transfer_lines.transfer_id
      and (public.can_access_warehouse(t.source_warehouse_id) or public.can_access_warehouse(t.destination_warehouse_id))
  ));
create policy "Scoped insert transfer_lines"
  on public.transfer_lines for insert to authenticated
  with check (public.is_approved() and exists (
    select 1 from public.transfers t where t.id = transfer_lines.transfer_id
      and (public.can_access_warehouse(t.source_warehouse_id) or public.can_access_warehouse(t.destination_warehouse_id))
  ));
create policy "Scoped update transfer_lines"
  on public.transfer_lines for update to authenticated
  using (public.is_approved() and exists (
    select 1 from public.transfers t where t.id = transfer_lines.transfer_id
      and (public.can_access_warehouse(t.source_warehouse_id) or public.can_access_warehouse(t.destination_warehouse_id))
  ))
  with check (public.is_approved() and exists (
    select 1 from public.transfers t where t.id = transfer_lines.transfer_id
      and (public.can_access_warehouse(t.source_warehouse_id) or public.can_access_warehouse(t.destination_warehouse_id))
  ));
create policy "Managers delete transfer_lines"
  on public.transfer_lines for delete to authenticated
  using (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager') and exists (
    select 1 from public.transfers t where t.id = transfer_lines.transfer_id
      and (public.can_access_warehouse(t.source_warehouse_id) or public.can_access_warehouse(t.destination_warehouse_id))
  ));

-- ============================================================
-- 8. STOCK_ADJUSTMENTS: scoped via the linked pallet or balance.
--    Both fk columns are nullable (set null on delete), so an
--    orphaned adjustment with neither link falls back to visible
--    -- there is no warehouse left to check it against.
-- ============================================================
drop policy if exists "Approved users can read stock_adjustments" on public.stock_adjustments;
drop policy if exists "Approved users can insert stock_adjustments" on public.stock_adjustments;
drop policy if exists "Approved users can update stock_adjustments" on public.stock_adjustments;
drop policy if exists "Approved users can delete stock_adjustments" on public.stock_adjustments;

create policy "Scoped read stock_adjustments"
  on public.stock_adjustments for select to authenticated
  using (
    public.is_approved()
    and (
      (pallet_id is null and inventory_balance_id is null)
      or exists (select 1 from public.pallets p where p.id = stock_adjustments.pallet_id and public.can_access_warehouse(p.current_warehouse_id))
      or exists (select 1 from public.inventory_balances ib where ib.id = stock_adjustments.inventory_balance_id and public.can_access_warehouse(ib.warehouse_id))
    )
  );
create policy "Scoped insert stock_adjustments"
  on public.stock_adjustments for insert to authenticated
  with check (
    public.is_approved()
    and (
      (pallet_id is null and inventory_balance_id is null)
      or exists (select 1 from public.pallets p where p.id = stock_adjustments.pallet_id and public.can_access_warehouse(p.current_warehouse_id))
      or exists (select 1 from public.inventory_balances ib where ib.id = stock_adjustments.inventory_balance_id and public.can_access_warehouse(ib.warehouse_id))
    )
  );
create policy "Scoped update stock_adjustments"
  on public.stock_adjustments for update to authenticated
  using (
    public.is_approved()
    and (
      (pallet_id is null and inventory_balance_id is null)
      or exists (select 1 from public.pallets p where p.id = stock_adjustments.pallet_id and public.can_access_warehouse(p.current_warehouse_id))
      or exists (select 1 from public.inventory_balances ib where ib.id = stock_adjustments.inventory_balance_id and public.can_access_warehouse(ib.warehouse_id))
    )
  )
  with check (
    public.is_approved()
    and (
      (pallet_id is null and inventory_balance_id is null)
      or exists (select 1 from public.pallets p where p.id = stock_adjustments.pallet_id and public.can_access_warehouse(p.current_warehouse_id))
      or exists (select 1 from public.inventory_balances ib where ib.id = stock_adjustments.inventory_balance_id and public.can_access_warehouse(ib.warehouse_id))
    )
  );
create policy "Managers delete stock_adjustments"
  on public.stock_adjustments for delete to authenticated
  using (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager'));

-- ============================================================
-- 9. Low-sensitivity operational tables with no warehouse concept
--    (inventory_lots, barcode_labels): leave read/insert/update as
--    approved-only, just close the delete gap for consistency --
--    there is no delete UI for either today.
-- ============================================================
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['inventory_lots', 'barcode_labels'] loop
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = format('Approved users can delete %s', t)
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;
    execute format(
      'create policy "Managers delete %I" on public.%I for delete to authenticated using (public.is_approved() and public.has_min_role(auth.uid(), ''warehouse_manager''))',
      t, t
    );
  end loop;
end $$;

-- ============================================================
-- 10. AUDIT_EVENTS: append-only from the app's point of view (the
--     write path is the SECURITY DEFINER log_audit_event function,
--     which runs as the table owner and bypasses these policies).
--     Direct table writes are restricted to admin tier.
-- ============================================================
drop policy if exists "Approved users can insert audit_events" on public.audit_events;
drop policy if exists "Approved users can update audit_events" on public.audit_events;
drop policy if exists "Approved users can delete audit_events" on public.audit_events;

create policy "Admins write audit_events"
  on public.audit_events for insert to authenticated
  with check (public.is_approved() and public.has_min_role(auth.uid(), 'admin'));
create policy "Admins update audit_events"
  on public.audit_events for update to authenticated
  using (public.is_approved() and public.has_min_role(auth.uid(), 'admin'))
  with check (public.is_approved() and public.has_min_role(auth.uid(), 'admin'));
create policy "Admins delete audit_events"
  on public.audit_events for delete to authenticated
  using (public.is_approved() and public.has_min_role(auth.uid(), 'admin'));

-- ============================================================
-- 11. STORAGE BUCKETS: require approval, not just a valid session.
-- ============================================================
drop policy if exists "Storage access authenticated" on storage.objects;

create policy "Approved users manage wms storage objects"
  on storage.objects for all to authenticated
  using (bucket_id in ('labels', 'imports', 'attachments') and public.is_approved())
  with check (bucket_id in ('labels', 'imports', 'attachments') and public.is_approved());

-- ============================================================
-- 12. SECURITY DEFINER FUNCTIONS: revoke anon/public execute by
--     default across the exposed public schema, keeping only the
--     pre-auth login-code resolver anon-callable. Trigger functions
--     are skipped -- they cannot be invoked directly via PostgREST
--     RPC and already have their own explicit grants.
-- ============================================================
do $$
declare
  fn record;
  anon_allowlist text[] := array['resolve_login_code'];
begin
  for fn in
    select p.oid::regprocedure as signature, p.proname as fname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and p.prorettype <> 'trigger'::regtype
  loop
    if fn.fname = any(anon_allowlist) then
      execute format('revoke all on function %s from public', fn.signature);
      execute format('grant execute on function %s to anon, authenticated', fn.signature);
    else
      execute format('revoke all on function %s from anon, public', fn.signature);
      execute format('grant execute on function %s to authenticated', fn.signature);
    end if;
  end loop;
end $$;
