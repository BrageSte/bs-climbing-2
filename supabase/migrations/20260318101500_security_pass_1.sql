-- Security Pass 1: AAL2 helpers, audit trail, and shared edge rate limiting.

CREATE OR REPLACE FUNCTION public.is_aal2()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((auth.jwt() ->> 'aal') = 'aal2', false)
$$;

CREATE OR REPLACE FUNCTION public.is_admin_aal2()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin() AND public.is_aal2()
$$;

CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  actor_user_id UUID,
  actor_aal TEXT,
  order_id UUID,
  route TEXT,
  subject_hash TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON public.audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_event_type_created_at_idx
  ON public.audit_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_order_id_created_at_idx
  ON public.audit_events(order_id, created_at DESC);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.audit_events FROM anon, authenticated;
GRANT SELECT ON public.audit_events TO authenticated;

DROP POLICY IF EXISTS "Admins can view audit events" ON public.audit_events;
CREATE POLICY "Admins can view audit events"
  ON public.audit_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin_aal2());

CREATE OR REPLACE FUNCTION public.write_audit_event(
  p_event_type TEXT,
  p_order_id UUID DEFAULT NULL,
  p_route TEXT DEFAULT NULL,
  p_subject_hash TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_events (
    event_type,
    actor_user_id,
    actor_aal,
    order_id,
    route,
    subject_hash,
    payload
  )
  VALUES (
    p_event_type,
    auth.uid(),
    auth.jwt() ->> 'aal',
    p_order_id,
    p_route,
    p_subject_hash,
    COALESCE(p_payload, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_orders_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.write_audit_event(
        'admin.order_status_changed',
        OLD.id,
        NULL,
        NULL,
        jsonb_build_object(
          'from', OLD.status,
          'to', NEW.status
        )
      );
    END IF;

    IF NEW.internal_notes IS DISTINCT FROM OLD.internal_notes THEN
      PERFORM public.write_audit_event(
        'admin.order_notes_changed',
        OLD.id,
        NULL,
        NULL,
        jsonb_build_object(
          'from', OLD.internal_notes,
          'to', NEW.internal_notes
        )
      );
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.write_audit_event(
      'admin.order_deleted',
      OLD.id,
      NULL,
      NULL,
      jsonb_build_object(
        'status', OLD.status,
        'production_number', OLD.production_number
      )
    );

    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS audit_orders_after_update ON public.orders;
CREATE TRIGGER audit_orders_after_update
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_orders_mutation();

DROP TRIGGER IF EXISTS audit_orders_before_delete ON public.orders;
CREATE TRIGGER audit_orders_before_delete
  BEFORE DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_orders_mutation();

CREATE TABLE IF NOT EXISTS public.edge_rate_limits (
  route TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (route, fingerprint),
  CONSTRAINT edge_rate_limits_request_count_check CHECK (request_count >= 0)
);

ALTER TABLE public.edge_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.edge_rate_limits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_edge_rate_limit(
  p_route TEXT,
  p_fingerprint TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  retry_after_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ts TIMESTAMPTZ := now();
  current_row public.edge_rate_limits%ROWTYPE;
  elapsed_seconds INTEGER;
BEGIN
  IF p_route IS NULL OR btrim(p_route) = '' THEN
    RAISE EXCEPTION 'p_route is required';
  END IF;

  IF p_fingerprint IS NULL OR btrim(p_fingerprint) = '' THEN
    RAISE EXCEPTION 'p_fingerprint is required';
  END IF;

  IF p_limit <= 0 OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'p_limit and p_window_seconds must be positive';
  END IF;

  INSERT INTO public.edge_rate_limits AS rl (
    route,
    fingerprint,
    window_started_at,
    request_count,
    created_at,
    updated_at
  )
  VALUES (
    btrim(p_route),
    btrim(p_fingerprint),
    now_ts,
    1,
    now_ts,
    now_ts
  )
  ON CONFLICT (route, fingerprint) DO UPDATE
  SET
    request_count = CASE
      WHEN EXTRACT(EPOCH FROM (now_ts - rl.window_started_at)) >= p_window_seconds THEN 1
      ELSE rl.request_count + 1
    END,
    window_started_at = CASE
      WHEN EXTRACT(EPOCH FROM (now_ts - rl.window_started_at)) >= p_window_seconds THEN now_ts
      ELSE rl.window_started_at
    END,
    updated_at = now_ts
  RETURNING * INTO current_row;

  elapsed_seconds := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now_ts - current_row.window_started_at)))::INTEGER);

  IF current_row.request_count > p_limit THEN
    RETURN QUERY
    SELECT
      false,
      0,
      GREATEST(1, p_window_seconds - elapsed_seconds);
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    true,
    GREATEST(0, p_limit - current_row.request_count),
    0;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_edge_rate_limit(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_edge_rate_limit(TEXT, TEXT, INTEGER, INTEGER) TO service_role;

-- Orders
DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
CREATE POLICY "Admins can view all orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (public.is_admin_aal2());

DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
CREATE POLICY "Admins can update orders"
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_aal2())
  WITH CHECK (public.is_admin_aal2());

DROP POLICY IF EXISTS "Admins can delete orders" ON public.orders;
CREATE POLICY "Admins can delete orders"
  ON public.orders
  FOR DELETE
  TO authenticated
  USING (public.is_admin_aal2());

GRANT DELETE ON public.orders TO authenticated;

-- Order events
DROP POLICY IF EXISTS "Admins can view order events" ON public.order_events;
CREATE POLICY "Admins can view order events"
  ON public.order_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin_aal2());

-- Files
DROP POLICY IF EXISTS "Admins can view files" ON public.files;
CREATE POLICY "Admins can view files"
  ON public.files
  FOR SELECT
  TO authenticated
  USING (public.is_admin_aal2());

DROP POLICY IF EXISTS "Admins can insert files" ON public.files;
CREATE POLICY "Admins can insert files"
  ON public.files
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_aal2());

DROP POLICY IF EXISTS "Admins can update files" ON public.files;
CREATE POLICY "Admins can update files"
  ON public.files
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_aal2())
  WITH CHECK (public.is_admin_aal2());

DROP POLICY IF EXISTS "Admins can delete files" ON public.files;
CREATE POLICY "Admins can delete files"
  ON public.files
  FOR DELETE
  TO authenticated
  USING (public.is_admin_aal2());

-- Checkout sessions
DROP POLICY IF EXISTS "Admins can view checkout sessions" ON public.checkout_sessions;
CREATE POLICY "Admins can view checkout sessions"
  ON public.checkout_sessions
  FOR SELECT
  TO authenticated
  USING (public.is_admin_aal2());

DROP POLICY IF EXISTS "Admins can update checkout sessions" ON public.checkout_sessions;
CREATE POLICY "Admins can update checkout sessions"
  ON public.checkout_sessions
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_aal2())
  WITH CHECK (public.is_admin_aal2());

-- Site settings
DROP POLICY IF EXISTS "Admins can read settings" ON public.site_settings;
CREATE POLICY "Admins can read settings"
  ON public.site_settings
  FOR SELECT
  TO authenticated
  USING (public.is_admin_aal2());

DROP POLICY IF EXISTS "Admins can update settings" ON public.site_settings;
CREATE POLICY "Admins can update settings"
  ON public.site_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_aal2())
  WITH CHECK (public.is_admin_aal2());

DROP POLICY IF EXISTS "Admins can insert settings" ON public.site_settings;
CREATE POLICY "Admins can insert settings"
  ON public.site_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_aal2());

DROP POLICY IF EXISTS "Admins can delete settings" ON public.site_settings;
CREATE POLICY "Admins can delete settings"
  ON public.site_settings
  FOR DELETE
  TO authenticated
  USING (public.is_admin_aal2());
