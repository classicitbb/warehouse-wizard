-- Helper: check any of multiple roles
CREATE OR REPLACE FUNCTION public.has_any_role(_roles public.app_role_code[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.code = ANY (SELECT unnest(_roles)::text)
  );
$$;

-- Remaining tables
CREATE TABLE IF NOT EXISTS public.ai_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_key text NOT NULL,
  title text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical','warning','info','success')),
  audience public.app_role_code[] NOT NULL,
  reason text NOT NULL,
  next_action text NOT NULL,
  status public.recommendation_status NOT NULL DEFAULT 'open',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  acted_by uuid REFERENCES auth.users(id),
  acted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quality_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_number text NOT NULL UNIQUE,
  pallet_id uuid REFERENCES public.pallets(id),
  receipt_id uuid REFERENCES public.receipts(id),
  disposition public.quality_disposition NOT NULL DEFAULT 'pending',
  pass_fail_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  root_cause_code text,
  corrective_action text,
  inspected_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.return_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rma_number text NOT NULL UNIQUE,
  client_id uuid REFERENCES public.clients(id),
  warehouse_id uuid REFERENCES public.warehouses(id),
  status public.task_status NOT NULL DEFAULT 'queued',
  disposition public.quality_disposition NOT NULL DEFAULT 'pending',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.dock_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_number text NOT NULL UNIQUE,
  warehouse_id uuid REFERENCES public.warehouses(id),
  dock_door text NOT NULL,
  carrier text,
  driver_name text,
  scheduled_at timestamptz NOT NULL,
  status public.task_status NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staging_loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_list_id uuid REFERENCES public.pick_lists(id),
  dock_appointment_id uuid REFERENCES public.dock_appointments(id),
  route_code text NOT NULL,
  load_sequence integer NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','called','loading','blocked','loaded')),
  blocker text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.replenishment_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_number text NOT NULL UNIQUE,
  product_id uuid REFERENCES public.products(id),
  warehouse_id uuid REFERENCES public.warehouses(id),
  from_location_id uuid REFERENCES public.locations(id),
  to_location_id uuid REFERENCES public.locations(id),
  reorder_point numeric NOT NULL DEFAULT 0,
  target_quantity numeric NOT NULL DEFAULT 0,
  status public.task_status NOT NULL DEFAULT 'queued',
  assigned_user_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.work_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  workflow text NOT NULL,
  priority integer NOT NULL DEFAULT 50,
  query_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  step_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_status ON public.ai_recommendations(status, severity);
CREATE INDEX IF NOT EXISTS idx_staging_loads_status ON public.staging_loads(status, route_code);

-- Updated_at triggers for tables with updated_at
DROP TRIGGER IF EXISTS trg_staging_loads_updated ON public.staging_loads;
CREATE TRIGGER trg_staging_loads_updated BEFORE UPDATE ON public.staging_loads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_work_templates_updated ON public.work_templates;
CREATE TRIGGER trg_work_templates_updated BEFORE UPDATE ON public.work_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS on new tables
ALTER TABLE public.ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quality_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dock_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replenishment_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_templates ENABLE ROW LEVEL SECURITY;

-- Apply unified RLS pattern to all 17 enterprise tables (drop existing part-1 policies first)
DO $$
DECLARE
  t text;
  enterprise_tables text[] := ARRAY[
    'integration_connections','external_record_links','integration_sync_jobs',
    'integration_payload_logs','integration_dead_letters','report_definitions',
    'report_exports','printer_stations','label_templates','print_jobs',
    'ai_recommendations','quality_inspections','return_authorizations',
    'dock_appointments','staging_loads','replenishment_tasks','work_templates'
  ];
  policy_rec record;
BEGIN
  FOREACH t IN ARRAY enterprise_tables LOOP
    -- Drop ALL existing policies on this table to reset cleanly
    FOR policy_rec IN
      SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_rec.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "Approved users read %I" ON public.%I FOR SELECT TO authenticated USING (public.is_approved())',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "Managers manage %I" ON public.%I FOR ALL TO authenticated USING (public.has_any_role(ARRAY[''admin''::public.app_role_code, ''warehouse_manager''::public.app_role_code])) WITH CHECK (public.has_any_role(ARRAY[''admin''::public.app_role_code, ''warehouse_manager''::public.app_role_code]))',
      t, t
    );
  END LOOP;
END $$;

-- Seed default report definitions
INSERT INTO public.report_definitions (code, name, audience, filters, columns)
VALUES
  ('expiration-risk', 'Expiration Risk', ARRAY['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code], '{"days": 30}'::jsonb, '["sku","lot","expiry_date","available_quantity","warehouse","location"]'::jsonb),
  ('low-stock', 'Low Stock Warnings', ARRAY['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code], '{"threshold": 10}'::jsonb, '["sku","available_quantity","warehouse","location","netsuite_status"]'::jsonb),
  ('six-sigma-variance', 'Six Sigma Variance', ARRAY['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code], '{}'::jsonb, '["count_number","sku","variance_quantity","variance_percent","root_cause_code"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- Seed default label templates
INSERT INTO public.label_templates (code, label_type, printer_language, template_body)
VALUES
  ('zpl-pallet-default', 'pallet', 'zpl', '^XA^CI28^PW609^LL406^FO28,24^GB553,358,3^FS^FO40,44^A0N,36,36^FD{{title}}^FS^FO40,134^BY2,3,88^BCN,88,Y,N,N^FD{{code}}^FS^XZ'),
  ('zpl-location-default', 'location', 'zpl', '^XA^CI28^PW609^LL300^FO32,32^A0N,42,42^FD{{location_code}}^FS^FO32,100^BY2,3,100^BCN,100,Y,N,N^FD{{location_code}}^FS^XZ')
ON CONFLICT (code) DO NOTHING;