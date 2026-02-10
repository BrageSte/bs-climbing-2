import { supabase, supabasePublicConfig, supabasePublicConfigReason } from "@/integrations/supabase/client";

function hostnameFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export default function SupabaseConfigNotice() {
  const shouldShow = supabase === null || supabasePublicConfig.source !== "env";
  if (!shouldShow) return null;

  const host = hostnameFromUrl(supabasePublicConfig.url);
  const sourceLabel =
    supabasePublicConfig.source === "fallback"
      ? "fallback (dev only)"
      : supabasePublicConfig.source === "missing"
      ? "missing"
      : "env";

  return (
    <div className="mt-16 border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="leading-snug">
          <span className="font-semibold">Supabase-oppsett:</span>{" "}
          Sett <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.85em]">VITE_SUPABASE_URL</code>{" "}
          og{" "}
          <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.85em]">
            VITE_SUPABASE_PUBLISHABLE_KEY
          </code>{" "}
          i Lovable Project Settings.
          {supabasePublicConfig.source === "fallback" && (
            <span className="block text-xs text-muted-foreground">
              Kjører med fallback i dev/preview for å unngå blank screen.
            </span>
          )}
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

