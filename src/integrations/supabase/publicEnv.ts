export type SupabasePublicConfigSource = "env" | "baked" | "missing";

export type SupabasePublicConfig = {
  url: string | null;
  key: string | null;
  source: SupabasePublicConfigSource;
};

export type SupabasePublicConfigWithReason = SupabasePublicConfig & {
  // Human-readable reason why env was not used (missing/invalid).
  reason: string | null;
};

// Public (browser-safe) baked defaults.
//
// This repo is deployed via Lovable, but Lovable may not always inject Vite env vars.
// These values are safe to expose in the browser (publishable/anon).
//
// If you cut over to a new Supabase project, update these baked values (and redeploy),
// or override via Vite env vars when your host supports them.
const BAKED_URL = "https://bfxypsjdwdrgedxyiaba.supabase.co";
const BAKED_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmeHlwc2pkd2RyZ2VkeHlpYWJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MjI3ODAsImV4cCI6MjA4NjI5ODc4MH0.3AMUtofdxarX4yaYmbLsiNHwhnnU8ADA9aBWUqMeGvg";

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
    problems.push("VITE_SUPABASE_PUBLISHABLE_KEY (eller VITE_SUPABASE_ANON_KEY/VITE_SUPABASE_KEY) mangler");
  }

  return problems;
}

export function getSupabasePublicConfig(): SupabasePublicConfigWithReason {
  const rawUrl = import.meta.env["VITE_SUPABASE_URL"] as unknown;
  const rawKey = (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
    import.meta.env["VITE_SUPABASE_ANON_KEY"] ??
    import.meta.env["VITE_SUPABASE_KEY"]) as unknown;

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

  const bakedProblems = validatePublicEnv(BAKED_URL, BAKED_KEY);
  if (bakedProblems.length === 0) {
    // In some hosts (Lovable included), Vite env injection for `VITE_*` may not be available.
    // These values are public, so default to the baked-in config when env is missing/invalid.
    return {
      url: BAKED_URL,
      key: BAKED_KEY,
      source: "baked",
      reason,
    };
  }

  return {
    url: null,
    key: null,
    source: "missing",
    reason: [reason, ...bakedProblems].filter(Boolean).join(". "),
  };
}
