ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS position smallint;
CREATE INDEX IF NOT EXISTS locations_warehouse_bay_level_position_idx
  ON public.locations (warehouse_id, aisle, bay, level, position);