// Stable Supabase client for browser runtime.
//
// Goal: Avoid Lovable blank screens / ESM export mismatches when `src/integrations/supabase/client.ts`
// is regenerated or when Vite env injection is unavailable on the host.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { getSupabasePublicConfig, type SupabasePublicConfig } from "./publicEnv";

const configWithReason = getSupabasePublicConfig();

export const supabasePublicConfig: SupabasePublicConfig = {
  url: configWithReason.url,
  key: configWithReason.key,
  source: configWithReason.source,
};

export const supabasePublicConfigReason = configWithReason.reason;

export const supabase: SupabaseClient<Database> | null = (() => {
  const { url, key, source } = supabasePublicConfig;
  const hasBrowserStorage =
    typeof window !== "undefined" &&
    typeof window.localStorage?.getItem === "function" &&
    typeof window.localStorage?.setItem === "function";

  if (!url || !key) {
    if (source !== "missing") {
      console.warn("[supabase] Missing public config, supabase client disabled.", {
        source,
        urlPresent: Boolean(url),
        keyPresent: Boolean(key),
      });
    }
    return null;
  }

  if (source !== "env") {
    // Don't log the key. URL + source is enough for debugging.
    console.warn("[supabase] Using non-env Supabase config.", { source, url });
  }

  try {
    return createClient<Database>(url, key, {
      auth: {
        storage: hasBrowserStorage ? window.localStorage : undefined,
        persistSession: hasBrowserStorage,
        autoRefreshToken: hasBrowserStorage,
      },
    });
  } catch (error) {
    console.error("[supabase] Failed to create client.", { source, url, error });
    return null;
  }
})();

export function requireSupabase(): SupabaseClient<Database> {
  if (supabase) return supabase;

  const hint =
    "Supabase er ikke konfigurert. Oppdater baked config i src/integrations/supabase/publicEnv.ts eller sett VITE_SUPABASE_URL + (VITE_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_ANON_KEY) der hosten stotter det.";

  const reason = supabasePublicConfigReason ? ` (${supabasePublicConfigReason})` : "";
  throw new Error(`${hint}${reason}`);
}
