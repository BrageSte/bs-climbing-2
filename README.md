# BS Climbing

BS Climbing er en React/Vite-app for konfigurering, salg og produksjonsoppfolging av custom klatreblokker. Repoet inneholder frontend, Supabase edge functions, migrasjoner, adminflyt og eksport til Fusion CSV.

## Kom i gang

```sh
npm install
npm run dev
```

For lokal utvikling brukes `.env`. Se `.env.example` for browser-safe eksempelverdier.

## Drift og dokumentasjon

Operative styringsdokumenter ligger i `docs/ops`:

- `docs/ops/repo-map.md`
- `docs/ops/checklist.md`
- `docs/ops/agent-governance.md`
- `docs/ops/security-check.md`

Disse dokumentene er startpunktet for endringer i checkout, priser, sikkerhet, produksjon og deploy.

## Viktige kommandoer

- `npm run dev`: lokal utviklingsserver
- `npm run build`: komprimerer assets, bygger appen og sjekker bundle-budget
- `npm run lint`: generell lint
- `npm test`: kjrer Vitest
- `npm run security:lint`: sikkerhetslint for edge functions og scripts
- `npm run security:secrets`: enkel scan etter uventede hemmeligheter i repoet
- `npm run security:audit`: `npm audit` med baseline-kontroll
- `npm run security:check`: samlet sikkerhetsbaseline
- `npm run supabase:functions:deploy`: deploy av edge functions
- `npm run supabase:secrets:set`: setter driftsscrets i Supabase

## Supabase og offentlig konfig

Klienten bruker offentlig Supabase-konfig fra `src/integrations/supabase/publicEnv.ts` hvis `VITE_*`-variabler ikke er tilgjengelige hos hosten. Denne baked konfigen skal alltid vaere browser-safe og ma vurderes eksplisitt ved prosjektbytte eller deploy til nytt miljo.

Mulige overstyringer via miljo:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_KEY`

Private nokler og service-role-verdier skal aldri inn i klientkode og skal kun ligge i Supabase secrets.

## Ordrestatus-feilkoder

- `OS_MISSING_ORDER_ID`: ordrenummer mangler i foresporselen
- `OS_NOT_FOUND`: ordren finnes ikke i prosjektet
- `OS_DB_ERROR`: feil under oppslag i databasen
- `OS_CONFIG_MISSING`: edge function mangler nodvendig konfigurasjon
- `OS_EDGE_HTTP_ERROR`: kall til edge function feilet uten spesifikk kode

## Produksjonsnummer og Fusion CSV

- kjor migrasjoner med Supabase for eksport tas i bruk
- `production_number` tildeles forste gang en ordre eksporteres
- `ModellID` i CSV er `BS-` + `production_number` med fire siffer
- `EdgeMode` i CSV er `0` for short edge og `1` for long edge
- bulk-eksport sorteres pa `production_number` for deterministisk printkjo
