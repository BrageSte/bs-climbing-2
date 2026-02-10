# Supabase Cutover Runbook

This runbook migrates production from an old Supabase project to a new Supabase project while keeping Loveable as deploy frontend host.

## Scope

- Keep Loveable deploy flow.
- Move critical data (`site_settings`, `orders`, `order_events`, `files`, `checkout_sessions`).
- Keep same Stripe account.
- Move Stripe webhook to new Supabase edge function endpoint.

## Prerequisites

- Access to both databases:
  - `OLD_DB_URL` (source project)
  - `NEW_DB_URL` (target project)
- Supabase CLI installed and authenticated.
- PostgreSQL client tools installed (`pg_dump`, `psql`).
- Stripe dashboard access for webhook updates.
- Resend API key for e-mail function.

## New controls added

- `site_settings.maintenance_mode`:
  - `enabled`: boolean
  - `message`: string
- Admin can toggle maintenance mode in `/admin/settings`.
- `create-checkout` edge function rejects checkout when maintenance mode is enabled.
- Free-order path also rejects when maintenance mode is enabled.

## Files added for migration

- `scripts/supabase/export-critical-data.sh`
- `scripts/supabase/import-critical-data.sh`
- `scripts/supabase/validate-critical-data.sh`
- `scripts/supabase/deploy-functions.sh`
- `scripts/supabase/set-secrets.sh`
- `supabase/sql/cutover_helpers.sql`

## Phase 1: Pre-cutover setup (day(s) before)

1. Point local Supabase CLI to new project and run migrations.
2. Deploy edge functions:
```bash
scripts/supabase/deploy-functions.sh <NEW_PROJECT_REF>
```
3. Set function secrets in new project:
```bash
scripts/supabase/set-secrets.sh <NEW_PROJECT_REF> path/to/new-project.secrets.env
```
Required secret keys:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `PUBLIC_SITE_URL`

Notes:
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are reserved and injected automatically in Supabase Edge Functions.

4. Create admin users in new project and grant roles:
```sql
-- Use statements from supabase/sql/cutover_helpers.sql
```

5. Prepare Stripe:
- Create new webhook endpoint to new project (keep old endpoint active for now).
- Events required: `checkout.session.completed`, `checkout.session.expired`.

## Phase 2: Dry run (non-live)

1. Export data from old project:
```bash
OLD_DB_URL='postgresql://...' scripts/supabase/export-critical-data.sh
```
2. Import into new project:
```bash
NEW_DB_URL='postgresql://...' scripts/supabase/import-critical-data.sh tmp/data_migration_YYYYMMDD_HHMMSS.sql
```
3. Validate counts and totals:
```bash
OLD_DB_URL='postgresql://...' NEW_DB_URL='postgresql://...' scripts/supabase/validate-critical-data.sh
```
4. If `files` rows exist, also migrate storage objects for referenced paths.

## Phase 3: Cutover day (30-60 min window)

1. In admin settings, enable maintenance mode for checkout.
2. Confirm no active checkout attempts in progress.
3. Take final export:
```bash
OLD_DB_URL='postgresql://...' scripts/supabase/export-critical-data.sh tmp/data_migration_final.sql
```
4. Import final export to new project:
```bash
NEW_DB_URL='postgresql://...' scripts/supabase/import-critical-data.sh tmp/data_migration_final.sql
```
5. Validate data:
```bash
OLD_DB_URL='postgresql://...' NEW_DB_URL='postgresql://...' scripts/supabase/validate-critical-data.sh
```
6. Update Lovable deploy Supabase config:
- If Lovable supports Vite env vars in Project Settings:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`)
- If Lovable does not support env vars for this project:
  - Update baked values in `src/integrations/supabase/publicEnv.ts`
  - Re-publish from Lovable

7. Publish new build from Loveable.
8. In Stripe, switch primary webhook endpoint to new project.
9. Disable maintenance mode in admin settings.

## Phase 4: Post-cutover (day 1-3)

1. Monitor:
- `checkout_sessions.status` distribution
- new `orders` rows
- `order_events` from Stripe webhook
- `send-order-confirmation` success/failure logs

2. Keep old Stripe webhook active for 48-72h for safety.
3. After stability window, disable old webhook endpoint.

## Validation checklist

- Card checkout succeeds.
- Vipps checkout succeeds.
- 100% promo free-order flow succeeds.
- Order status page returns expected order from new project.
- Admin login and order updates work.
- Data totals/counts match expected source.
- Order confirmation e-mails are delivered.

## Rollback

1. Re-enable maintenance mode in checkout immediately.
2. Set Loveable env back to old `VITE_SUPABASE_URL` and old publishable key.
3. Re-publish Loveable build.
4. Keep old webhook active until incident is resolved.

## Notes

- Do not migrate Supabase Auth users automatically in this runbook.
- Recreate admins manually in new Auth and assign roles in `public.user_roles`.
