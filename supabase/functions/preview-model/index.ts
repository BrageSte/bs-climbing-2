/**
 * preview-model — Supabase Edge Function
 *
 * POST /functions/v1/preview-model
 * Input:  { params: { widths, heights, depth, edgeMode }, hash? }
 * Output: { hash, urlStl }
 *
 * Pipeline:
 *  1. Normaliser + clamp params.
 *  2. Beregn sha256 hash.
 *  3. Sjekk om previews/{hash}.stl finnes i Supabase Storage.
 *     - Hit  → return signert URL.
 *     - Miss → generer STL, last opp, return URL.
 *
 * Generering er deterministisk: samme params → samme hash → samme STL.
 * Concurrent requests med samme hash er idempotente (siste upload vinner,
 * innholdet er identisk).
 *
 * TODO: Implementer faktisk STL-generering.  Nåværende skeleton returnerer
 * en statisk fallback-URL (compact / longedge STL) fra public assets.
 *
 * Denne edge-funksjonen er offentlig for nettleser-preview. Beskyttelse skal
 * komme fra CORS, rate limiting og streng input-normalisering, ikke fra et
 * klienteksponert VITE-token.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { serveCors } from "../_shared/cors.ts";
import {
  enforceRateLimit,
  readJsonBody,
  secureErrorResponse,
  secureJsonResponse,
} from "../_shared/security.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Param types + normalisation
// ---------------------------------------------------------------------------

interface RawParams {
  widths?: Record<string, number>;
  heights?: Record<string, number>;
  depth?: number;
  edgeMode?: number;
}

interface NormalizedParams {
  depth: number;
  edgeMode: number;
  heights: { langfinger: number; lillefinger: number; pekefinger: number; ringfinger: number };
  widths: { langfinger: number; lillefinger: number; pekefinger: number; ringfinger: number };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function asNum(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return fallback;
}

function normalize(raw: RawParams): NormalizedParams {
  const w = raw.widths ?? {};
  const h = raw.heights ?? {};
  return {
    depth: round2(clamp(asNum(raw.depth, 24), 10, 50)),
    edgeMode: asNum(raw.edgeMode, 0) === 1 ? 1 : 0,
    heights: {
      langfinger: round2(clamp(asNum(h.langfinger, 20), 1, 80)),
      lillefinger: round2(clamp(asNum(h.lillefinger, 10), 1, 80)),
      pekefinger: round2(clamp(asNum(h.pekefinger, 17), 1, 80)),
      ringfinger: round2(clamp(asNum(h.ringfinger, 15), 1, 80)),
    },
    widths: {
      langfinger: round2(clamp(asNum(w.langfinger, 20), 10, 40)),
      lillefinger: round2(clamp(asNum(w.lillefinger, 21), 10, 40)),
      pekefinger: round2(clamp(asNum(w.pekefinger, 22), 10, 40)),
      ringfinger: round2(clamp(asNum(w.ringfinger, 20), 10, 40)),
    },
  };
}

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// STL generation placeholder
// ---------------------------------------------------------------------------

/**
 * TODO: Replace with actual parametric STL generation.
 *
 * Options for server-side STL generation (in priority order):
 *  1. Run a headless Fusion 360 / FreeCAD script via a container sidecar.
 *  2. Use a JS-based CSG library (e.g. three-bvh-csg, manifold-3d WASM).
 *  3. Use OpenSCAD CLI in a Docker container triggered via queue.
 *
 * For now we return null to indicate "no generated file available",
 * which causes the function to return the static fallback URL.
 */
async function _generateStl(
  _params: NormalizedParams,
): Promise<Uint8Array | null> {
  // Placeholder: return null → caller uses static fallback
  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(serveCors(async (req) => {
  if (req.method !== "POST") {
    return secureErrorResponse("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");
  if (!supabaseUrl || !serviceKey) {
    return secureErrorResponse("CONFIG_MISSING", "Server configuration incomplete.", 500);
  }

  try {
    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const rateLimitResponse = await enforceRateLimit({
      req,
      supabaseAdmin: sb,
      rateLimitSecret,
      route: "preview-model",
      limit: 30,
      windowSeconds: 60,
      auditEventType: "preview.rate_limited",
    });
    if (rateLimitResponse) return rateLimitResponse;

    const parsedBody = await readJsonBody<Record<string, unknown>>(req, 4 * 1024);
    if ("response" in parsedBody) return parsedBody.response;

    const body = parsedBody.data;
    const rawParams: RawParams = isRecord(body) && isRecord(body.params) ? body.params as RawParams : {};
    const normalized = normalize(rawParams);
    const hash = await sha256(JSON.stringify(normalized));
    const storagePath = `previews/${hash}.stl`;

    // 1. Check if file already exists in storage
    const { data: existing } = await sb.storage
      .from("models")
      .createSignedUrl(storagePath, 3600); // 1 hour URL

    if (existing?.signedUrl) {
      return secureJsonResponse({ hash, urlStl: existing.signedUrl });
    }

    // 2. Try to generate
    const stlBytes = await _generateStl(normalized);

    if (stlBytes) {
      // Upload to storage
      const { error: uploadErr } = await sb.storage
        .from("models")
        .upload(storagePath, stlBytes, {
          contentType: "model/stl",
          upsert: true, // idempotent
        });

      if (uploadErr) {
        console.error("[preview-model] upload error:", uploadErr);
        return secureErrorResponse("UPLOAD_FAILED", "Upload failed.", 500);
      }

      const { data: url } = await sb.storage
        .from("models")
        .createSignedUrl(storagePath, 3600);

      if (url?.signedUrl) {
        return secureJsonResponse({ hash, urlStl: url.signedUrl });
      }
    }

    // 3. Fallback: return static model URL based on edgeMode
    const fallbackUrl =
      normalized.edgeMode === 1
        ? "/models/blokk_longedge.stl"
        : "/models/blokk_shortedge.stl";

    return secureJsonResponse({ hash, urlStl: fallbackUrl, fallback: true });
  } catch (err: unknown) {
    console.error("[preview-model] unexpected error:", err);
    return secureErrorResponse("INTERNAL_ERROR", "Internal error.", 500);
  }
}));
