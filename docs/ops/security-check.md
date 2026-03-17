# Sikkerhetssjekk

Dette dokumentet beskriver sikkerhetsbaseline v1 for BS Climbing-repoet. Malet er a synliggjore risiko tidlig og holde en fast minimumskontroll i lokal utvikling og CI.

## Fast baseline

Kjor disse kommandoene ved deploy-naere endringer og alltid etter avhengighetsoppgraderinger:

```bash
npm run lint
npm test
npm run security:lint
npm run security:secrets
npm run security:audit
```

`npm run security:check` kjorer hele sikkerhetsbaselinen samlet.

## Hva sjekkes

### 1. Avhengigheter

`npm run security:audit` kjorer `npm audit --json` via et kontrollscript.

V1 tillater kun dagens kjente baseline-funn:

- `flatted` med hoy risiko, transitiv via ESLint-kjeden
- `undici` med hoy risiko, transitiv via `jsdom` i testmiljoet

Alle nye funn eller endret alvorlighetsgrad skal feile sjekken.

### 2. Statisk kodekontroll

`npm run security:lint` bruker `eslint-plugin-security` mot:

- `supabase/functions/**/*`
- `scripts/**/*`

Dette er bevisst avgrenset til server- og scriptkode i v1 for a fa hoy signal/stoy-ratio. Frontend holdes pa eksisterende lint-oppsett inntil vi eventuelt utvider reglene.

### 3. Secrets-kontroll

`npm run security:secrets` sjekker repoet for mulige innskrevne hemmeligheter, blant annet:

- Stripe live secret keys
- Stripe webhook secrets
- Supabase secret/service-role-lignende tokens
- OpenAI API-nokler

Tillatte unntak i v1:

- `.env.example`
- `scripts/supabase/new-project.secrets.env.example`
- `src/integrations/supabase/publicEnv.ts`

Siste fil er tillatt fordi den kun skal inneholde browser-safe public config.

### 4. Manuell miljo- og secrets-kontroll

Sjekk at:

- `src/integrations/supabase/publicEnv.ts` kun inneholder browser-safe URL + publishable/anon key
- `scripts/supabase/set-secrets.sh` fortsatt krever `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `PUBLIC_SITE_URL` og `ORDER_STATUS_SECRET`
- service-role og andre private verdier kun ligger i Supabase secrets, ikke i klientkode

### 5. Data- og tilgangskontroll

Ved endringer i backend skal disse punktene verifiseres manuelt:

- public klient skal ikke kunne opprette ordre direkte med egne priser
- `create-checkout` skal fortsatt beregne priser server-side
- migrasjoner som paavirker `orders`, `checkout_sessions`, `site_settings` eller RLS skal leses og vurderes eksplisitt
- HMAC/token-beskyttede flyter for ordrestatus og checkout-resultat skal ikke svekkes

## Kjente forhold per 17.03.2026

- `npm audit` rapporterer 2 hoyrisiko-funn i transitive avhengigheter
- `npm run lint` passerer med 11 warnings og 0 errors
- repoet hadde ingen CI-workflow foer denne baselinen
- `src/components/ui/chart.tsx` bruker `dangerouslySetInnerHTML` kontrollert til CSS-variabler; dette skal ikke behandles som automatisk sarbarhet uten konkret dataflyt

## CI-policy v1

CI skal:

- feile pa nye eller endrede sikkerhetsfunn
- feile pa sikkerhetslint-errors
- feile pa mulige uventede hemmeligheter i repoet

CI skal ikke feile kun fordi kjent baseline fortsatt finnes i `flatted` og `undici`, sa lenge de er de eneste funnene og dokumentasjonen holdes oppdatert.
