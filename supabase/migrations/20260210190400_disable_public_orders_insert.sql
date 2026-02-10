-- Once free orders are handled server-side (service role), public inserts are no longer needed.
-- This reduces exposure and fixes permissive RLS policy warnings.

DROP POLICY IF EXISTS "Allow public order creation" ON public.orders;
DROP POLICY IF EXISTS "Anyone can create orders" ON public.orders;
DROP POLICY IF EXISTS "Public can create orders" ON public.orders;
DROP POLICY IF EXISTS "Anon can view own order after insert" ON public.orders;

REVOKE INSERT ON public.orders FROM anon;
REVOKE INSERT ON public.orders FROM authenticated;
REVOKE SELECT ON public.orders FROM anon;

