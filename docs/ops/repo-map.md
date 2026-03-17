# Repo Map

Dette dokumentet er en operativ oversikt over hvordan repoet er organisert per 17.03.2026, og hvordan kodebasen henger sammen med styringsdokumentet `BS_Climbing_Styringsdokument_v2.md`.

## Formaal og faktisk system

Repoet inneholder produksjonsnaer kode for BS Climbing-butikken:

- React/Vite-frontend for landing page, konfigurator, handlekurv, checkout, ordrestatus og admin
- Supabase backend med migrasjoner og edge functions for checkout, webhook, status og e-post
- produksjonsflyt for Fusion CSV-eksport og produksjonsnummer
- scripts for modellkomprimering, bundle-kontroll og Supabase deploy/secrets

Styringsdokumentet beskriver prosjektet riktig pa hoyt nivaa. Dette repoet er den tekniske source of truth for det som faktisk er implementert.

## Hovedomraader

### Frontend og app-lag

- `src/pages/*`: ruter for kunde- og adminflyt
- `src/components/configurator/*`: produktvalg, maalehjelp og 3D-forhandsvisning
- `src/contexts/CartContext.tsx`: klientlagret handlekurv
- `src/hooks/*`: datahenting, settings, admin og preview-logikk
- `src/lib/fusionCsvExport.ts`: produksjonskritisk eksport til Fusion CSV
- `src/integrations/supabase/*`: offentlig Supabase-klient og baked public config

### Backend og data

- `supabase/functions/create-checkout`: server-side prisberegning og oppstart av checkout
- `supabase/functions/stripe-webhook`: endelig betalingsbekreftelse og ordreopprettelse
- `supabase/functions/send-order-confirmation`: e-post og ordrelenker
- `supabase/functions/get-checkout-result`, `verify-session`, `get-order-status`, `validate-promo`: kontrollert kunde- og statusflyt
- `supabase/migrations/*`: database, RLS, statusfelt, produksjonsnummer og site settings

### Drift og verkttoy

- `scripts/check-bundle-budget.mjs`: hindrer at 3D/vendor-bundle vokser ukontrollert
- `scripts/compress-model-assets.mjs`: komprimerer STL-assets for build
- `scripts/supabase/*`: deploy av edge functions og setting av secrets
- `scripts/security/*`: lokal sikkerhetskontroll for audit og hemmeligheter

### Assets og generert innhold

- `public/models/*`: STL-filer og gzip-varianter brukt i preview/fallback
- `public/images/measure-help/*`: veiledningsbilder
- `dist/*`: bygde filer, generert artefakt
- `node_modules/*`: genererte avhengigheter

## Operativ status per mappe

### Operativt aktive mapper

- `src`
- `supabase`
- `scripts`
- `public`
- `docs/ops`

### Genererte eller deploy-artefakter

- `dist`
- `node_modules`
- `supabase/.temp`

### Eksperimentelle eller delvis uferdige spor

- `supabase/functions/preview-model`: skeleton/TODO for server-side preview-generering
- deler av STL/preview-oppsettet er operative i frontend, men ikke ferdigstilt som full server-side produksjonsflyt

## Produksjonsflyt i kode

1. Kunde konfigurerer produkt i frontend
2. Handlekurv og checkout bygges i klienten
3. `create-checkout` henter `site_settings` og beregner pris server-side
4. Stripe-session eller gratis ordre-flyt opprettes server-side
5. `stripe-webhook` eller `verify-session` bekrefter resultat
6. Ordre lagres med status og snapshots i Supabase
7. `send-order-confirmation` sender ordrebekreftelse
8. Admin eksporterer Fusion CSV via `src/lib/fusionCsvExport.ts`
9. produksjonsnummer tildeles via RPC ved eksport

## Source of truth

- Kode og flyt: repoet
- database, RLS og secrets: Supabase prosjekt + migrasjoner i repoet
- priser, frakt og promo: `site_settings`, ikke frontend-hardkoding
- produksjonsparametre: `src/lib/fusionCsvExport.ts` + relevante migrasjoner/RPC
- offentlig Supabase browser-konfig: `src/integrations/supabase/publicEnv.ts`
- operative beslutninger: styringsdokumentet og `docs/ops/*`

## Hoyrisiko-omraader

- `supabase/functions/create-checkout`
- `supabase/functions/stripe-webhook`
- `supabase/functions/send-order-confirmation`
- migrasjoner som endrer `orders`, `site_settings`, `checkout_sessions`, RLS eller produksjonsnummer

Endringer her skal alltid vurderes som sikkerhets- eller driftskritiske.

## Operative kontrollpunkter

- `src/lib/fusionCsvExport.ts`: ma ikke endres uten a verifisere produksjonsnummer, ModellID og CSV-format
- `src/integrations/supabase/publicEnv.ts`: browser-safe baked config ma holdes offentlig og konsistent ved prosjektbytte
- `scripts/supabase/set-secrets.sh`: styrer hvilke secrets som ma finnes for drift

## Dagens kontrollstatus

- tester fungerer, men dekker bare 6 tester totalt
- `npm run lint` passerer med 11 warnings og 0 errors
- repoet hadde ingen `.github`-workflow for CI for dette styringsloftet
- `src/components/ui/chart.tsx` bruker `dangerouslySetInnerHTML` kontrollert for CSS-variabler; dette skal vurderes med kontekst og ikke flagges blindt som sarbarhet
