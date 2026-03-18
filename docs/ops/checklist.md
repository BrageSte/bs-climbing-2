# Operativ sjekkliste

Kort sjekkliste for endringer som kan paavirke drift, sikkerhet, priser eller produksjon.

## For kodeendring

- les `docs/ops/repo-map.md` og finn hvilken del av flyten endringen treffer
- les relevante source-of-truth-filer for du endrer noe
- avklar om endringen er frontend, backend, migrasjon eller produksjonsflyt
- sjekk at priser, frakt og promo fortsatt styres fra `site_settings`
- sjekk at ingen hemmeligheter eller service-role-verdier hardkodes

## For deploy

- kjor `npm run lint`
- kjor `npm test`
- kjor `npm run security:check`
- verifiser at `.env` og Supabase secrets matcher forventet miljo
- verifiser at `RATE_LIMIT_SECRET` er satt i Supabase secrets for miljoet
- verifiser at eventuelle migrasjoner er klare for `supabase db push`

## For pris- eller checkout-endring

- verifiser at `create-checkout` fortsatt beregner pris server-side
- verifiser at frontend ikke innforer nye hardkodede priser
- verifiser at `site_settings` er oppdatert og konsistent
- verifiser at offentlige checkout-/status-endepunkter fortsatt returnerer kontrollerte 4xx-feil ved limit/invalid input
- test betalt flyt og gratis ordre-flyt ende til ende
- vurder konsekvens for Stripe/Vipps og ordrebekreftelse

## For produksjonseksport og Fusion CSV

- verifiser `src/lib/fusionCsvExport.ts`
- verifiser at `assign_production_number` fortsatt brukes riktig
- test en enkel eksport og en bulk-eksport
- verifiser `ModellID`, filnavn og sortering i printkjo
- sjekk at endringen ikke bryter eksisterende Fusion-parameternavn

## Etter sikkerhetsfunn eller avhengighetsoppgradering

- kjor `npm run security:audit`
- vurder om funnet er nytt eller del av kjent baseline
- oppdater dokumentasjon hvis baseline endres
- test lint, test og kritiske edge functions pa nytt
- bekreft at kjente browser-safe nokler fortsatt er de eneste offentlige verdiene i klienten
