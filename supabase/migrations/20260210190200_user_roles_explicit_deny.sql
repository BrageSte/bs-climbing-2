-- Lovable/Supabase linters may flag missing explicit deny policies.
-- Ensure non-admin users cannot enumerate roles.

DROP POLICY IF EXISTS "Public cannot view roles" ON public.user_roles;
CREATE POLICY "Public cannot view roles"
  ON public.user_roles
  FOR SELECT
  TO anon, authenticated
  USING (false);

