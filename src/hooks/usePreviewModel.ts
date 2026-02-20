/**
 * usePreviewModel — debounced preview-model fetcher.
 *
 * Når params endres:
 *  1. Normaliser + hash (SHA-256, deterministisk).
 *  2. Sjekk in-memory cache.  Hit → return cached URL umiddelbart.
 *  3. Miss → POST /api/preview-model (Supabase Edge Function) etter 600ms debounce.
 *  4. Forrige in-flight request avbrytes via AbortController.
 *
 * Returnerer { modelUrl, isGenerating, error }.
 *
 * Når backend ikke er tilgjengelig ennå, faller hooken tilbake til
 * en statisk URL basert på edgeMode (compact / longedge STL).
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreviewParams {
  widths: {
    lillefinger: number;
    ringfinger: number;
    langfinger: number;
    pekefinger: number;
  };
  heights: {
    lillefinger: number;
    ringfinger: number;
    langfinger: number;
    pekefinger: number;
  };
  depth: number;
  edgeMode: number; // 0 = compact/short, 1 = long
  modelId?: string;
}

interface PreviewResult {
  /** URL to load in BlockViewer.  Falls back to static STL when API unavailable. */
  modelUrl: string;
  /** True while waiting for debounce or API response. */
  isGenerating: boolean;
  /** Error message from last failed request, or null. */
  error: string | null;
  /** The hash of the currently resolved URL (or null while loading). */
  hash: string | null;
}

// ---------------------------------------------------------------------------
// Normalise + hash
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function normalizeParams(p: PreviewParams): Record<string, unknown> {
  return {
    depth: round2(clamp(p.depth, 10, 50)),
    edgeMode: p.edgeMode === 1 ? 1 : 0,
    heights: {
      langfinger: round2(clamp(p.heights.langfinger, 1, 80)),
      lillefinger: round2(clamp(p.heights.lillefinger, 1, 80)),
      pekefinger: round2(clamp(p.heights.pekefinger, 1, 80)),
      ringfinger: round2(clamp(p.heights.ringfinger, 1, 80)),
    },
    widths: {
      langfinger: round2(clamp(p.widths.langfinger, 10, 40)),
      lillefinger: round2(clamp(p.widths.lillefinger, 10, 40)),
      pekefinger: round2(clamp(p.widths.pekefinger, 10, 40)),
      ringfinger: round2(clamp(p.widths.ringfinger, 10, 40)),
    },
  };
}

async function hashParams(normalized: Record<string, unknown>): Promise<string> {
  const json = JSON.stringify(normalized);
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(json),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// In-memory cache (hash → URL)
// ---------------------------------------------------------------------------

const urlCache = new Map<string, string>();

// ---------------------------------------------------------------------------
// Static fallback URLs (used when API is not deployed)
// ---------------------------------------------------------------------------

const STATIC_URLS: Record<number, string> = {
  0: "/models/blokk_shortedge.stl",
  1: "/models/blokk_longedge.stl",
};

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

/**
 * Placeholder: when the Supabase Edge Function `preview-model` is deployed,
 * change this to the real endpoint URL.
 */
const API_ENDPOINT: string | null = null; // e.g. "https://<project>.supabase.co/functions/v1/preview-model"

async function fetchPreviewUrl(
  normalized: Record<string, unknown>,
  hash: string,
  signal: AbortSignal,
): Promise<string> {
  if (!API_ENDPOINT) {
    // No backend yet — return static fallback
    const edgeMode = (normalized.edgeMode as number) ?? 0;
    return STATIC_URLS[edgeMode] ?? STATIC_URLS[0];
  }

  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params: normalized, hash }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const data = (await res.json()) as { hash: string; urlStl: string };
  return data.urlStl;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 600;

export function usePreviewModel(params: PreviewParams): PreviewResult {
  const [modelUrl, setModelUrl] = useState<string>(
    STATIC_URLS[params.edgeMode] ?? STATIC_URLS[0],
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Serialise params to a stable string for dependency tracking
  const paramKey = useMemo(() => JSON.stringify(normalizeParams(params)), [params]);

  const resolve = useCallback(async (key: string) => {
    const normalized = JSON.parse(key) as Record<string, unknown>;
    const h = await hashParams(normalized);

    // Cache hit
    const cached = urlCache.get(h);
    if (cached) {
      setModelUrl(cached);
      setHash(h);
      setIsGenerating(false);
      setError(null);
      return;
    }

    // Abort previous in-flight request
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setIsGenerating(true);
    setError(null);

    try {
      const url = await fetchPreviewUrl(normalized, h, ac.signal);
      urlCache.set(h, url);
      setModelUrl(url);
      setHash(h);
      setError(null);
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return; // superseded
      console.error("[usePreviewModel]", err);
      setError((err as Error).message ?? "Ukjent feil");
    } finally {
      setIsGenerating(false);
    }
  }, []);

  useEffect(() => {
    // Debounce
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => resolve(paramKey), DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [paramKey, resolve]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { modelUrl, isGenerating, error, hash };
}
