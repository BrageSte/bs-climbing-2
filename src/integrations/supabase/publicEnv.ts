export type SupabasePublicConfigSource = "env" | "fallback" | "missing";

export type SupabasePublicConfig = {
  url: string | null;
  key: string | null;
  source: SupabasePublicConfigSource;
};

export type SupabasePublicConfigWithReason = SupabasePublicConfig & {
  // Human-readable reason why env was not used (missing/invalid).
  reason: string | null;
};

// Public (browser-safe) defaults used only for dev/preview to avoid blank screens when
// Lovable preview doesn't have env set up yet. Production must always be configured via env.
const FALLBACK_URL = "https://bfxypsjdwdrgedxyiaba.supabase.co";
const FALLBACK_KEY = "sb_publishable_wifNwaLO3kjTCSuB7Ix6aw_0hPQmx6C";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validatePublicEnv(url: unknown, key: unknown): string[] {
  const problems: string[] = [];

  if (!isNonEmptyString(url)) {
    problems.push("VITE_SUPABASE_URL mangler");
  } else if (!url.trim().startsWith("https://")) {
    problems.push("VITE_SUPABASE_URL ma starte med https://");
  }

  if (!isNonEmptyString(key)) {
    problems.push("VITE_SUPABASE_PUBLISHABLE_KEY mangler");
  }

  return problems;
}

export function getSupabasePublicConfig(): SupabasePublicConfigWithReason {
  const rawUrl = import.meta.env.VITE_SUPABASE_URL as unknown;
  const rawKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as unknown;

  const problems = validatePublicEnv(rawUrl, rawKey);
  if (problems.length === 0) {
    return {
      url: (rawUrl as string).trim(),
      key: (rawKey as string).trim(),
      source: "env",
      reason: null,
    };
  }

  const reason = problems.join(". ");

  // Lovable preview domains often run a production build, where `import.meta.env.DEV` is false.
  // Allow fallback on those hosts to avoid blank/blocked previews when env isn't injected.
  const isLovablePreviewHost =
    typeof window !== "undefined" && window.location.hostname.endsWith(".lovableproject.com");

  if (import.meta.env.DEV || isLovablePreviewHost) {
    return {
      url: FALLBACK_URL,
      key: FALLBACK_KEY,
      source: "fallback",
      reason,
    };
  }

  return {
    url: null,
    key: null,
    source: "missing",
    reason,
  };
}
