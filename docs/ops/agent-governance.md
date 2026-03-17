# Styringsdokument for agenter

Dette dokumentet beskriver hvordan AI-agenter og automatiserte kodeassistenter skal jobbe i BS Climbing-repoet.

## Formaal

Agenter skal forbedre fart og kvalitet uten a svekke kontroll, sikkerhet eller produksjonsflyt. Repoet skal behandles som et operativt system for handel og produksjon, ikke som en uforpliktende prototype.

## Source of truth

Agenter skal forholde seg til disse sannhetskildene:

- kode og implementert flyt i repoet
- `supabase/migrations/*` for database og RLS
- `site_settings` for priser, frakt, promo og checkout maintenance
- `src/lib/fusionCsvExport.ts` for Fusion CSV-logikk
- `src/integrations/supabase/publicEnv.ts` for offentlig browser-konfig
- `docs/ops/*` og styringsdokumentet for operativ styring

## Obligatorisk lesing for hoyrisiko-endringer

Foer agenten foreslar eller implementerer endringer i checkout, ordre, produksjon eller sikkerhet, skal den lese relevante filer i dette minimumssettet:

- `docs/ops/repo-map.md`
- `docs/ops/security-check.md`
- `src/lib/fusionCsvExport.ts` ved produksjons- eller eksportendringer
- `src/integrations/supabase/publicEnv.ts` ved miljo- eller Supabase-endringer
- `supabase/functions/create-checkout/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/send-order-confirmation/index.ts`
- relevante migrasjoner dersom database, RLS eller statusfelt berorers

## Regler agenter ikke skal bryte

- ikke hardkod priser, frakt eller promo i frontend hvis samme verdi skal komme fra `site_settings`
- ikke legg hemmeligheter, service-role-verdier eller private tokens i repoet
- ikke opprett ordre direkte fra klient med klientbestemte priser
- ikke endre migrasjoner eller edge functions uten a vurdere RLS, service-role og dataflyt
- ikke anta at baked Supabase-konfig kan inneholde private nokler; den ma alltid vaere browser-safe
- ikke tolke kontrollert `dangerouslySetInnerHTML` som automatisk sikkerhetsfeil uten kontekst

## Hoyrisiko-omraader

- `supabase/functions/create-checkout`
- `supabase/functions/stripe-webhook`
- `supabase/functions/send-order-confirmation`
- migrasjoner som endrer `orders`, `site_settings`, `checkout_sessions`, RLS eller produksjonsnummer

Endringer her skal behandles som om de kan paavirke betaling, sikkerhet, persondata og operativ drift.

## Ferdig-definisjon for agentforslag

Et forslag er ikke ferdig for dette repoet for disse kontrollene er gjort eller eksplisitt blokkert:

- `npm run lint`
- `npm test`
- `npm run security:check`
- kort risikovurdering dersom checkout, admin, priser, ordrestatus eller produksjon berorers
- oppdatering av relevant dokumentasjon i `docs/ops/*` eller `README.md` hvis flyt eller kontroll endres

## Eskaleringsregler

Agenten skal stoppe og varsle bruker hvis den oppdager:

- konflikt mellom repoet og styringsdokumentet
- nye sikkerhetsfunn som ikke er del av kjent baseline
- behov for a endre offentlig eksponerte nokler eller secrets-flyt
- endringer som kan bryte produksjonsnummer, CSV-format eller ordresporing
