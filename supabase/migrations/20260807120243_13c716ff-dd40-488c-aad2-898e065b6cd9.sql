ALTER TABLE public.pick_tasks
  ADD COLUMN IF NOT EXISTS picked_pallet_id uuid REFERENCES public.pallets(id),
  ADD COLUMN IF NOT EXISTS picked_location_id uuid REFERENCES public.locations(id),
  ADD COLUMN IF NOT EXISTS source_override_reason text;