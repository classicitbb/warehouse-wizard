CREATE TABLE IF NOT EXISTS public.ai_product_hints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES public.products(id)   ON DELETE CASCADE,
  warehouse_id     uuid NOT NULL REFERENCES public.warehouses(id)  ON DELETE CASCADE,
  hint_type        text NOT NULL CHECK (hint_type IN ('pallet_qty', 'placement', 'velocity')),
  hint_value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_count     integer NOT NULL DEFAULT 1,
  confidence       numeric(5, 4) CHECK (confidence BETWEEN 0 AND 1),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_product_hints_unique_idx
  ON public.ai_product_hints (product_id, warehouse_id, hint_type);

CREATE INDEX IF NOT EXISTS ai_product_hints_product_warehouse_idx
  ON public.ai_product_hints (product_id, warehouse_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_product_hints TO authenticated;
GRANT ALL ON public.ai_product_hints TO service_role;

ALTER TABLE public.ai_product_hints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_product_hints approved read" ON public.ai_product_hints;
CREATE POLICY "ai_product_hints approved read" ON public.ai_product_hints
  FOR SELECT TO authenticated USING (public.is_approved());

DROP POLICY IF EXISTS "ai_product_hints approved insert" ON public.ai_product_hints;
CREATE POLICY "ai_product_hints approved insert" ON public.ai_product_hints
  FOR INSERT TO authenticated WITH CHECK (public.is_approved());

DROP POLICY IF EXISTS "ai_product_hints approved update" ON public.ai_product_hints;
CREATE POLICY "ai_product_hints approved update" ON public.ai_product_hints
  FOR UPDATE TO authenticated USING (public.is_approved()) WITH CHECK (public.is_approved());

CREATE OR REPLACE FUNCTION public.set_ai_product_hints_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_product_hints_updated_at ON public.ai_product_hints;
CREATE TRIGGER trg_ai_product_hints_updated_at
  BEFORE UPDATE ON public.ai_product_hints
  FOR EACH ROW EXECUTE FUNCTION public.set_ai_product_hints_updated_at();

-- Security: enable RLS on operator ticket tables
ALTER TABLE public.operator_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_ticket_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.operator_tickets TO authenticated;
GRANT ALL ON public.operator_tickets TO service_role;
GRANT SELECT, INSERT ON public.operator_ticket_events TO authenticated;
GRANT ALL ON public.operator_ticket_events TO service_role;

DROP POLICY IF EXISTS "operator_tickets read own or privileged" ON public.operator_tickets;
CREATE POLICY "operator_tickets read own or privileged" ON public.operator_tickets
  FOR SELECT TO authenticated
  USING (
    reported_by = auth.uid()
    OR assigned_to = auth.uid()
    OR public.has_any_role(ARRAY['admin','developer','dev','warehouse_manager']::app_role_code[])
  );

DROP POLICY IF EXISTS "operator_tickets insert own" ON public.operator_tickets;
CREATE POLICY "operator_tickets insert own" ON public.operator_tickets
  FOR INSERT TO authenticated
  WITH CHECK (reported_by = auth.uid() AND public.is_approved());

DROP POLICY IF EXISTS "operator_tickets update privileged" ON public.operator_tickets;
CREATE POLICY "operator_tickets update privileged" ON public.operator_tickets
  FOR UPDATE TO authenticated
  USING (
    reported_by = auth.uid()
    OR assigned_to = auth.uid()
    OR public.has_any_role(ARRAY['admin','developer','dev','warehouse_manager']::app_role_code[])
  )
  WITH CHECK (
    reported_by = auth.uid()
    OR assigned_to = auth.uid()
    OR public.has_any_role(ARRAY['admin','developer','dev','warehouse_manager']::app_role_code[])
  );

DROP POLICY IF EXISTS "operator_ticket_events read via ticket" ON public.operator_ticket_events;
CREATE POLICY "operator_ticket_events read via ticket" ON public.operator_ticket_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.operator_tickets t
      WHERE t.id = operator_ticket_events.ticket_id
        AND (
          t.reported_by = auth.uid()
          OR t.assigned_to = auth.uid()
          OR public.has_any_role(ARRAY['admin','developer','dev','warehouse_manager']::app_role_code[])
        )
    )
  );

DROP POLICY IF EXISTS "operator_ticket_events insert via ticket" ON public.operator_ticket_events;
CREATE POLICY "operator_ticket_events insert via ticket" ON public.operator_ticket_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.operator_tickets t
      WHERE t.id = operator_ticket_events.ticket_id
        AND (
          t.reported_by = auth.uid()
          OR t.assigned_to = auth.uid()
          OR public.has_any_role(ARRAY['admin','developer','dev','warehouse_manager']::app_role_code[])
        )
    )
  );