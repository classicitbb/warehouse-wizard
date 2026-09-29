-- AI product hints table
-- Stores rolling learned signals per product+warehouse:
--   pallet_qty  : modal/median units-per-pallet from receiving history
--   placement   : ranked list of locations this product is routinely put away to
--   velocity    : A/B/C pick-frequency class derived from inventory_balances activity
--
-- The application layer writes to this table via the ai-assist module and reads
-- it back to surface operator cues during receiving and putaway workflows.

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

-- One row per (product, warehouse, hint_type)
CREATE UNIQUE INDEX IF NOT EXISTS ai_product_hints_unique_idx
  ON public.ai_product_hints (product_id, warehouse_id, hint_type);

-- Fast lookup by product+warehouse (used in every operator cue fetch)
CREATE INDEX IF NOT EXISTS ai_product_hints_product_warehouse_idx
  ON public.ai_product_hints (product_id, warehouse_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_ai_product_hints_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_product_hints_updated_at ON public.ai_product_hints;
CREATE TRIGGER trg_ai_product_hints_updated_at
  BEFORE UPDATE ON public.ai_product_hints
  FOR EACH ROW EXECUTE FUNCTION public.set_ai_product_hints_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.ai_product_hints ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all hints (hints are not sensitive)
CREATE POLICY "ai_product_hints authenticated read"
  ON public.ai_product_hints
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert/update hints (application layer controls logic)
CREATE POLICY "ai_product_hints authenticated write"
  ON public.ai_product_hints
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "ai_product_hints authenticated update"
  ON public.ai_product_hints
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
