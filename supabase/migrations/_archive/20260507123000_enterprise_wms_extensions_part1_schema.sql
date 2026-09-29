-- Enterprise WMS extension, part 1:
-- enum types, tables, and indexes for integrations, reporting, printing, AI recommendations,
-- QA, returns, dock handoff, replenishment, and configurable work templates.

do $$ begin
  create type public.integration_system as enum ('netsuite', 'generic_rest');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.integration_job_status as enum ('queued', 'running', 'succeeded', 'failed', 'dead_letter');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.print_job_status as enum ('queued', 'sent', 'printed', 'failed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.recommendation_status as enum ('open', 'accepted', 'dismissed', 'resolved');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.quality_disposition as enum ('pending', 'pass', 'fail', 'hold', 'release', 'scrap', 'return_to_vendor');
exception when duplicate_object then null;
end $$;

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  system public.integration_system not null,
  name text not null,
  base_url text,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.external_record_links (
  id uuid primary key default gen_random_uuid(),
  system public.integration_system not null,
  local_table text not null,
  local_id uuid not null,
  external_record_type text not null,
  external_id text not null,
  external_url text,
  last_synced_at timestamptz,
  unique(system, local_table, local_id, external_record_type)
);

create table if not exists public.integration_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.integration_connections(id) on delete cascade,
  job_type text not null,
  status public.integration_job_status not null default 'queued',
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error_message text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id, idempotency_key)
);

create table if not exists public.integration_payload_logs (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid references public.integration_sync_jobs(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  payload jsonb not null,
  response jsonb,
  http_status integer,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_dead_letters (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid references public.integration_sync_jobs(id) on delete set null,
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.report_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  audience public.app_role_code[] not null default array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code],
  filters jsonb not null default '{}'::jsonb,
  columns jsonb not null default '[]'::jsonb,
  schedule_cron text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.report_exports (
  id uuid primary key default gen_random_uuid(),
  report_definition_id uuid references public.report_definitions(id) on delete cascade,
  requested_by uuid references auth.users(id),
  status text not null default 'queued',
  file_path text,
  row_count integer,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.printer_stations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  warehouse_id uuid references public.warehouses(id),
  printer_language text not null default 'zpl',
  network_address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.label_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label_type public.label_type not null,
  printer_language text not null default 'zpl',
  template_body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  printer_station_id uuid references public.printer_stations(id),
  label_template_id uuid references public.label_templates(id),
  barcode_label_id uuid references public.barcode_labels(id),
  status public.print_job_status not null default 'queued',
  zpl_payload text not null,
  error_message text,
  requested_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  printed_at timestamptz
);

create table if not exists public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  recommendation_key text not null,
  title text not null,
  severity text not null check (severity in ('critical', 'warning', 'info', 'success')),
  audience public.app_role_code[] not null,
  reason text not null,
  next_action text not null,
  status public.recommendation_status not null default 'open',
  context jsonb not null default '{}'::jsonb,
  acted_by uuid references auth.users(id),
  acted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.quality_inspections (
  id uuid primary key default gen_random_uuid(),
  inspection_number text not null unique,
  pallet_id uuid references public.pallets(id),
  receipt_id uuid references public.receipts(id),
  disposition public.quality_disposition not null default 'pending',
  pass_fail_criteria jsonb not null default '{}'::jsonb,
  root_cause_code text,
  corrective_action text,
  inspected_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.return_authorizations (
  id uuid primary key default gen_random_uuid(),
  rma_number text not null unique,
  client_id uuid references public.clients(id),
  warehouse_id uuid references public.warehouses(id),
  status public.task_status not null default 'queued',
  disposition public.quality_disposition not null default 'pending',
  reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.dock_appointments (
  id uuid primary key default gen_random_uuid(),
  appointment_number text not null unique,
  warehouse_id uuid references public.warehouses(id),
  dock_door text not null,
  carrier text,
  driver_name text,
  scheduled_at timestamptz not null,
  status public.task_status not null default 'queued',
  created_at timestamptz not null default now()
);

create table if not exists public.staging_loads (
  id uuid primary key default gen_random_uuid(),
  pick_list_id uuid references public.pick_lists(id),
  dock_appointment_id uuid references public.dock_appointments(id),
  route_code text not null,
  load_sequence integer not null default 10,
  status text not null default 'ready' check (status in ('ready', 'called', 'loading', 'blocked', 'loaded')),
  blocker text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.replenishment_tasks (
  id uuid primary key default gen_random_uuid(),
  task_number text not null unique,
  product_id uuid references public.products(id),
  warehouse_id uuid references public.warehouses(id),
  from_location_id uuid references public.locations(id),
  to_location_id uuid references public.locations(id),
  reorder_point numeric not null default 0,
  target_quantity numeric not null default 0,
  status public.task_status not null default 'queued',
  assigned_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.work_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  workflow text not null,
  priority integer not null default 50,
  query_rules jsonb not null default '{}'::jsonb,
  step_rules jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_external_record_links_lookup on public.external_record_links(system, external_record_type, external_id);
create index if not exists idx_integration_sync_jobs_status on public.integration_sync_jobs(status, created_at);
create index if not exists idx_print_jobs_status on public.print_jobs(status, created_at);
create index if not exists idx_ai_recommendations_status on public.ai_recommendations(status, severity);
create index if not exists idx_staging_loads_status on public.staging_loads(status, route_code);
