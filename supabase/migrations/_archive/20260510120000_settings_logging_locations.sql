-- ============================================================
-- 1. Client Variables – per-client key/value configuration
-- ============================================================
create table if not exists public.client_variables (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  key               text not null,
  value             text not null default '',
  variable_type     text not null default 'text'
                      check (variable_type in ('text','number','boolean','date','json')),
  description       text,
  is_hidden         boolean not null default false,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (client_id, key)
);

alter table public.client_variables enable row level security;

create policy "Authenticated users can read client_variables"
  on public.client_variables for select
  to authenticated using (true);

create policy "Admins and managers can insert client_variables"
  on public.client_variables for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'warehouse_manager'));

create policy "Admins and managers can update client_variables"
  on public.client_variables for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'warehouse_manager'));

create policy "Admins can delete client_variables"
  on public.client_variables for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 2. System Logs – software errors, bugs, system changes,
--    infrastructure events, and record-count snapshots
-- ============================================================
create table if not exists public.system_logs (
  id            uuid primary key default gen_random_uuid(),
  log_type      text not null default 'system_change'
                  check (log_type in (
                    'error', 'bug', 'system_change',
                    'infrastructure', 'record_count', 'info'
                  )),
  severity      text not null default 'info'
                  check (severity in ('debug','info','warning','error','critical')),
  title         text not null,
  message       text,
  details       jsonb,
  source        text,            -- component/module that generated the log
  table_name    text,            -- for record_count entries
  record_count  bigint,          -- snapshot count for that table
  resolved      boolean not null default false,
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users(id),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

alter table public.system_logs enable row level security;

create policy "Admins and managers can read system_logs"
  on public.system_logs for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'warehouse_manager'));

create policy "Authenticated users can insert system_logs"
  on public.system_logs for insert
  to authenticated
  with check (true);

create policy "Admins can update system_logs"
  on public.system_logs for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create index if not exists system_logs_log_type_idx on public.system_logs (log_type);
create index if not exists system_logs_created_at_idx on public.system_logs (created_at desc);
create index if not exists system_logs_severity_idx  on public.system_logs (severity);

-- Stored proc so the frontend can write a log in one RPC call
create or replace function public.write_system_log(
  in_log_type   text,
  in_severity   text,
  in_title      text,
  in_message    text   default null,
  in_details    jsonb  default null,
  in_source     text   default null,
  in_table_name text   default null,
  in_record_count bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.system_logs (
    log_type, severity, title, message, details,
    source, table_name, record_count, created_by
  )
  values (
    in_log_type, in_severity, in_title, in_message, in_details,
    in_source, in_table_name, in_record_count, auth.uid()
  )
  returning id into new_id;
  return new_id;
end;
$$;

-- ============================================================
-- 3. Location height constraint
--    max_pallet_height_cm  – hard ceiling (e.g. roof beam clearance)
--    notes                 – free-text reason field for special constraints
-- ============================================================
alter table public.locations
  add column if not exists max_pallet_height_cm integer check (max_pallet_height_cm > 0),
  add column if not exists location_notes       text;

comment on column public.locations.max_pallet_height_cm is
  'Maximum allowed pallet height in cm. NULL = no restriction. Used to block tall pallets from low-clearance bays near roof beams.';

-- ============================================================
-- 4. Pallet reuse – track which pallet label was reused so
--    audit trail stays complete. The column is nullable;
--    non-null means this pallet record reused an existing label.
-- ============================================================
alter table public.pallets
  add column if not exists reused_from_pallet_id uuid references public.pallets(id);

-- ============================================================
-- 5. Add client_variables to reset function
-- ============================================================
create or replace function public.reset_wms_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can reset the WMS environment';
  end if;

  update public.profiles
  set default_warehouse_id = null
  where default_warehouse_id is not null;

  update public.user_roles
  set warehouse_id = null,
      is_hidden = false,
      hidden_at = null,
      hidden_reason = null;

  truncate table
    public.ai_recommendations,
    public.integration_payload_logs,
    public.integration_dead_letters,
    public.integration_sync_jobs,
    public.external_record_links,
    public.integration_connections,
    public.report_exports,
    public.report_definitions,
    public.print_jobs,
    public.label_templates,
    public.printer_stations,
    public.work_templates,
    public.client_variables,
    public.system_logs
  restart identity cascade;

  truncate table
    public.audit_events,
    public.barcode_labels,
    public.stock_adjustments,
    public.cycle_count_lines,
    public.cycle_counts,
    public.staging_loads,
    public.dock_appointments,
    public.replenishment_tasks,
    public.quality_inspections,
    public.return_authorizations,
    public.transfer_lines,
    public.transfers,
    public.pick_tasks,
    public.pick_lists,
    public.order_lines,
    public.orders,
    public.move_tasks,
    public.putaway_tasks,
    public.inventory_balances,
    public.pallets,
    public.receipt_lines,
    public.receipts,
    public.inventory_lots,
    public.product_packaging_profiles,
    public.products,
    public.clients,
    public.locations,
    public.zones,
    public.warehouses
  restart identity cascade;

  return jsonb_build_object(
    'status', 'ok',
    'message', 'Warehouse data reset complete. Launch the setup wizard to rebuild the environment.'
  );
end;
$$;
