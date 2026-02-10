-- Hide promo_codes from anon/authenticated while keeping other settings public.
-- Admins (authenticated users with admin role) can still read all settings.

-- Ensure the public read policy exists and targets anon/authenticated explicitly.
ALTER POLICY "Anyone can read settings"
  ON public.site_settings
  TO anon, authenticated;

-- Exclude promo_codes from public reads.
ALTER POLICY "Anyone can read settings"
  ON public.site_settings
  USING (key <> 'promo_codes');

-- Allow admins to read all settings (including promo_codes).
DROP POLICY IF EXISTS "Admins can read settings" ON public.site_settings;
CREATE POLICY "Admins can read settings"
  ON public.site_settings
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

