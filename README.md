# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Lovable deploy (Supabase)

Lokalt bruker vi `.env` (ikke committed).

I Lovable er Vite env-injeksjon (`VITE_*`) ikke alltid tilgjengelig. Derfor bruker vi en baked (public) Supabase-konfig i:

- `src/integrations/supabase/publicEnv.ts`

Hvis hosten din stotter Vite env vars kan du overstyre baked config med:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (evt. `VITE_SUPABASE_ANON_KEY` / `VITE_SUPABASE_KEY`)

Se `.env.example` for eksempelverdier og format.

## Supabase/Stripe cutover

Denne appen bruker direkte Supabase-integrasjon (frontend + edge functions). For migrering mellom Supabase-prosjekter:

- Kjor runbook: `docs/supabase-cutover-runbook.md`
- Bruk skript i `scripts/supabase/` for eksport/import/validering/deploy
- Bruk secrets-mal: `scripts/supabase/new-project.secrets.env.example`
- SQL-hjelpere finnes i `supabase/sql/cutover_helpers.sql`

Viktig ved deploy etter cutover:

- `VITE_SUPABASE_URL` ma peke til nytt Supabase-prosjekt.
- `VITE_SUPABASE_PUBLISHABLE_KEY` ma bruke ny anon/publishable key.

Vedlikeholdsmodus for kasse styres via admin: `Admin > Settings > Vedlikeholdsmodus (kasse)`.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## Order status feilkoder

Kunder som sjekker ordrestatus kan se en feilkode. Bruk listen under ved support:

- `OS_MISSING_ORDER_ID`: Ordrenummer mangler i foresporselen.
- `OS_NOT_FOUND`: Ordren finnes ikke i Supabase-prosjektet denne siden peker til.
- `OS_DB_ERROR`: Feil under oppslag i databasen.
- `OS_CONFIG_MISSING`: Edge function mangler konfigurasjon (service role key).
- `OS_EDGE_HTTP_ERROR`: Kall til edge function feilet uten spesifikk feilkode.

## Produksjonsnummer og Fusion‑eksport

- Kjør migrasjoner med Supabase (f.eks. `supabase db push`) før eksport.
- `production_number` tildeles første gang en ordre eksporteres/lastes ned, og beholdes ved senere exporter.
- `ModellID` i Fusion‑CSV = `BS-` + `production_number` (4 siffer med ledende nuller).
- `EdgeMode` i Fusion‑CSV: `0` for Short edge, `1` for Long edge (case‑insensitive; støtter `short/long` og `Short edge/Long edge`).
- Bulk‑eksport sorteres på `production_number` stigende for deterministisk printkø.
