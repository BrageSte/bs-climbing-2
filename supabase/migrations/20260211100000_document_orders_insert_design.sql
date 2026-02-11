-- DOCUMENTATION: orders.INSERT is intentionally restricted to service_role only.
--
-- Migration 20260210190400 revoked INSERT from anon/authenticated and dropped
-- all public INSERT policies. This is by design:
--   - Paid orders are created by stripe-webhook (after Stripe signature verification)
--   - Free orders are created by create-checkout (server-side price calculation)
-- Both edge functions use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
--
-- DO NOT add a permissive INSERT policy for anon or authenticated.
-- Doing so would allow clients to create orders with arbitrary prices.

SELECT 1; -- no-op migration (documentation only)
