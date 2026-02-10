import { supabase, supabasePublicConfig, supabasePublicConfigReason } from "@/integrations/supabase/browserClient";

function hostnameFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export default function SupabaseConfigNotice() {
  // Avoid showing internal config details in production.
  if (!import.meta.env.DEV) return null;

  const shouldShow = supabase === null || supabasePublicConfig.source !== "env";
  if (!shouldShow) return null;

  const host = hostnameFromUrl(supabasePublicConfig.url);
  const sourceLabel =
    supabasePublicConfig.source === "baked"
      ? "baked (repo)"
      : supabasePublicConfig.source === "missing"
      ? "missing"
      : "env";

  return (
    <div className="mt-16 border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="leading-snug">
          <span className="font-semibold">Supabase-oppsett:</span>{" "}
          Kjører med baked Supabase-konfigurasjon (i repo).
          <span className="block text-xs text-muted-foreground">
            Hvis hosten din støtter Vite env vars kan du overstyre med{" "}
            <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.85em]">VITE_SUPABASE_URL</code>{" "}
            og{" "}
            <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.85em]">
              VITE_SUPABASE_PUBLISHABLE_KEY
            </code>
            {" "}
            (evt.{" "}
            <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.85em]">VITE_SUPABASE_ANON_KEY</code>
            ).
            .
          </span>
          {supabasePublicConfigReason && (
            <span className="block text-xs text-muted-foreground">Detaljer: {supabasePublicConfigReason}.</span>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          Kilde: <span className="font-mono">{sourceLabel}</span>
          {host ? <span className="ml-2 font-mono">({host})</span> : null}
        </div>
      </div>
    </div>
  );
}
