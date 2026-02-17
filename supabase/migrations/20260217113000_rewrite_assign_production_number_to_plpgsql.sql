-- Work around intermittent PostgreSQL internal error seen in SQL-language CTE version:
-- "AfterTriggerSaveEvent() called outside of query"
-- Behavior is unchanged: assign production_number/exported_at once, otherwise return existing values.

CREATE OR REPLACE FUNCTION public.assign_production_number(order_id UUID)
RETURNS TABLE (production_number BIGINT, exported_at TIMESTAMPTZ)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_production_number BIGINT;
  v_exported_at TIMESTAMPTZ;
BEGIN
  UPDATE public.orders
  SET
    production_number = COALESCE(public.orders.production_number, nextval('public.orders_production_number_seq')),
    exported_at = COALESCE(public.orders.exported_at, now())
  WHERE public.orders.id = order_id
    AND (public.orders.production_number IS NULL OR public.orders.exported_at IS NULL)
  RETURNING public.orders.production_number, public.orders.exported_at
  INTO v_production_number, v_exported_at;

  IF NOT FOUND THEN
    SELECT o.production_number, o.exported_at
    INTO v_production_number, v_exported_at
    FROM public.orders o
    WHERE o.id = order_id;
  END IF;

  IF v_production_number IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT v_production_number, v_exported_at;
END;
$$;
