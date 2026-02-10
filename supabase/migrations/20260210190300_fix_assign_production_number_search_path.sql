-- Fix "Function Search Path Mutable" linter warning by pinning search_path.
-- Keep function body identical to previous migration, only add SET search_path.

CREATE OR REPLACE FUNCTION public.assign_production_number(order_id UUID)
RETURNS TABLE (production_number BIGINT, exported_at TIMESTAMPTZ)
LANGUAGE sql
SET search_path = public
AS $$
  WITH updated AS (
    UPDATE public.orders
    SET
      production_number = COALESCE(production_number, nextval('public.orders_production_number_seq')),
      exported_at = COALESCE(exported_at, now())
    WHERE id = order_id
      AND (production_number IS NULL OR exported_at IS NULL)
    RETURNING production_number, exported_at
  )
  SELECT production_number, exported_at FROM updated
  UNION ALL
  SELECT production_number, exported_at
  FROM public.orders
  WHERE id = order_id
  LIMIT 1;
$$;

