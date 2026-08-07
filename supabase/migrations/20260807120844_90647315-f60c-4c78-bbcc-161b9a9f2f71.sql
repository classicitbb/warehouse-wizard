ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_stock_level_order;

ALTER TABLE public.products
  ADD CONSTRAINT products_stock_level_order CHECK (
    COALESCE(maximum_stock_level, 0) = 0
    OR (
      maximum_stock_level >= COALESCE(minimum_stock_level, 0)
      AND COALESCE(pick_down_to_level, 0) <= maximum_stock_level
    )
  );