-- checkout_sessions contains PII (email/phone/address/payment IDs). Lock it down to admins.

-- Allow authenticated role to attempt SELECT/UPDATE (RLS will still apply).
GRANT SELECT, UPDATE ON public.checkout_sessions TO authenticated;

DROP POLICY IF EXISTS "Admins can view checkout sessions" ON public.checkout_sessions;
CREATE POLICY "Admins can view checkout sessions"
  ON public.checkout_sessions
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update checkout sessions" ON public.checkout_sessions;
CREATE POLICY "Admins can update checkout sessions"
  ON public.checkout_sessions
  FOR UPDATE
  TO authenticated
  USING (public.is_admin());

