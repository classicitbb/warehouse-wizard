-- Helper function for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Enums
DO $$ BEGIN
  CREATE TYPE public.integration_system AS ENUM ('netsuite', 'generic_rest');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.integration_job_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'dead_letter');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.print_job_status AS ENUM ('queued', 'sent', 'printed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.recommendation_status AS ENUM ('open', 'accepted', 'dismissed', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.quality_disposition AS ENUM ('pending', 'pass', 'fail', 'hold', 'release', 'scrap', 'return_to_vendor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.app_role_code AS ENUM ('admin', 'warehouse_manager', 'inventory_clerk', 'warehouse_operator', 'dispatch_driver');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.label_type AS ENUM ('pallet', 'location', 'carton', 'count_sheet', 'pick_list', 'transfer_document');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tables
CREATE TABLE IF NOT EXISTS public.integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system public.integration_system NOT NULL,
  name text NOT NULL,
  base_url text,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.external_record_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system public.integration_system NOT NULL,
  local_table text NOT NULL,
  local_id uuid NOT NULL,
  external_record_type text NOT NULL,
  external_id text NOT NULL,
  external_url text,
  last_synced_at timestamptz,
  UNIQUE(system, local_table, local_id, external_record_type)
);

CREATE TABLE IF NOT EXISTS public.integration_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status public.integration_job_status NOT NULL DEFAULT 'queued',
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connection_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.integration_payload_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_job_id uuid REFERENCES public.integration_sync_jobs(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  payload jsonb NOT NULL,
  response jsonb,
  http_status integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.integration_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_job_id uuid REFERENCES public.integration_sync_jobs(id) ON DELETE SET NULL,
  reason text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  audience public.app_role_code[] NOT NULL DEFAULT ARRAY['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code],
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  schedule_cron text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_definition_id uuid REFERENCES public.report_definitions(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'queued',
  file_path text,
  row_count integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.printer_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  warehouse_id uuid REFERENCES public.warehouses(id),
  printer_language text NOT NULL DEFAULT 'zpl',
  network_address text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.label_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label_type public.label_type NOT NULL,
  printer_language text NOT NULL DEFAULT 'zpl',
  template_body text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_station_id uuid REFERENCES public.printer_stations(id),
  label_template_id uuid REFERENCES public.label_templates(id),
  barcode_label_id uuid REFERENCES public.barcode_labels(id),
  status public.print_job_status NOT NULL DEFAULT 'queued',
  zpl_payload text NOT NULL,
  error_message text,
  requested_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  printed_at timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_external_record_links_lookup ON public.external_record_links(system, external_record_type, external_id);
CREATE INDEX IF NOT EXISTS idx_external_record_links_local ON public.external_record_links(local_table, local_id);
CREATE INDEX IF NOT EXISTS idx_integration_sync_jobs_status ON public.integration_sync_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_integration_payload_logs_job ON public.integration_payload_logs(sync_job_id);
CREATE INDEX IF NOT EXISTS idx_integration_dead_letters_unresolved ON public.integration_dead_letters(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_report_exports_status ON public.report_exports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON public.print_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_station ON public.print_jobs(printer_station_id);

-- Updated_at triggers
DROP TRIGGER IF EXISTS trg_integration_connections_updated ON public.integration_connections;
CREATE TRIGGER trg_integration_connections_updated BEFORE UPDATE ON public.integration_connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_integration_sync_jobs_updated ON public.integration_sync_jobs;
CREATE TRIGGER trg_integration_sync_jobs_updated BEFORE UPDATE ON public.integration_sync_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_report_definitions_updated ON public.report_definitions;
CREATE TRIGGER trg_report_definitions_updated BEFORE UPDATE ON public.report_definitions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_printer_stations_updated ON public.printer_stations;
CREATE TRIGGER trg_printer_stations_updated BEFORE UPDATE ON public.printer_stations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_label_templates_updated ON public.label_templates;
CREATE TRIGGER trg_label_templates_updated BEFORE UPDATE ON public.label_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_record_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_payload_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printer_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users read integration_connections" ON public.integration_connections FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY "Admins manage integration_connections" ON public.integration_connections FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users read external_record_links" ON public.external_record_links FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY "Approved users write external_record_links" ON public.external_record_links FOR INSERT TO authenticated WITH CHECK (is_approved());
CREATE POLICY "Approved users update external_record_links" ON public.external_record_links FOR UPDATE TO authenticated USING (is_approved());
CREATE POLICY "Admins delete external_record_links" ON public.external_record_links FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users read integration_sync_jobs" ON public.integration_sync_jobs FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY "Approved users write integration_sync_jobs" ON public.integration_sync_jobs FOR INSERT TO authenticated WITH CHECK (is_approved());
CREATE POLICY "Approved users update integration_sync_jobs" ON public.integration_sync_jobs FOR UPDATE TO authenticated USING (is_approved());
CREATE POLICY "Admins delete integration_sync_jobs" ON public.integration_sync_jobs FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users read integration_payload_logs" ON public.integration_payload_logs FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY "Approved users write integration_payload_logs" ON public.integration_payload_logs FOR INSERT TO authenticated WITH CHECK (is_approved());

CREATE POLICY "Approved users read integration_dead_letters" ON public.integration_dead_letters FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY "Approved users write integration_dead_letters" ON public.integration_dead_letters FOR INSERT TO authenticated WITH CHECK (is_approved());
CREATE POLICY "Admins update integration_dead_letters" ON public.integration_dead_letters FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users read report_definitions" ON public.report_definitions FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY "Admins manage report_definitions" ON public.report_definitions FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users read report_exports" ON public.report_exports FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY "Approved users write report_exports" ON public.report_exports FOR INSERT TO authenticated WITH CHECK (is_approved());
CREATE POLICY "Approved users update report_exports" ON public.report_exports FOR UPDATE TO authenticated USING (is_approved());

CREATE POLICY "Approved users read printer_stations" ON public.printer_stations FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY "Admins manage printer_stations" ON public.printer_stations FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users read label_templates" ON public.label_templates FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY "Admins manage label_templates" ON public.label_templates FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Approved users read print_jobs" ON public.print_jobs FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY "Approved users write print_jobs" ON public.print_jobs FOR INSERT TO authenticated WITH CHECK (is_approved());
CREATE POLICY "Approved users update print_jobs" ON public.print_jobs FOR UPDATE TO authenticated USING (is_approved());