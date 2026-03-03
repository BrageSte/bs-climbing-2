/**
 * Shared CORS utility for all Edge Functions.
 *
 * Reads PUBLIC_SITE_URL from env to build an origin allowlist.
 * Localhost origins are allowed automatically for local development.
 * If PUBLIC_SITE_URL is not set, echoes back the request origin (permissive
 * fallback) with a console warning so that deploys without the env var
 * don't immediately break.
 */

const LOCALHOST_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1)(:\d+)?$/;

const BASE_ALLOWED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-supabase-client-platform",
  "x-supabase-client-platform-version",
  "x-supabase-client-runtime",
  "x-supabase-client-runtime-version",
];

let warnedMissing = false;

function buildAllowedOrigins(): string[] {
  const siteUrl = Deno.env.get("PUBLIC_SITE_URL")?.trim();
  if (!siteUrl) return [];

  try {
    const parsed = new URL(siteUrl);
    return [parsed.origin];
  } catch {
    console.warn("[cors] PUBLIC_SITE_URL is not a valid URL:", siteUrl);
    return [];
  }
}

// Pre-compute once at module load time (edge functions are long-lived workers).
const allowedOrigins = buildAllowedOrigins();

function resolveOrigin(origin: string | null): string | null {
  if (!origin) return null;

  // If PUBLIC_SITE_URL is configured, check against allowlist + localhost.
  if (allowedOrigins.length > 0) {
    if (allowedOrigins.includes(origin)) return origin;
    if (LOCALHOST_RE.test(origin)) return origin;
    return null;
  }

  // Fallback: no PUBLIC_SITE_URL configured — echo back origin (permissive).
  if (!warnedMissing) {
    console.warn(
      "[cors] PUBLIC_SITE_URL not set — CORS is permissive. " +
        "Set PUBLIC_SITE_URL to restrict allowed origins.",
    );
    warnedMissing = true;
  }
  return origin;
}

/**
 * Build CORS headers for a given request.
 *
 * @param req          Incoming request (reads the Origin header).
 * @param extraHeaders Additional Access-Control-Allow-Headers values
 *                     (e.g. ["stripe-signature", "x-order-status-token"]).
 */
export function getCorsHeaders(
  req: Request,
  extraHeaders?: string[],
): Record<string, string> {
  const allHeaders = extraHeaders
    ? [...BASE_ALLOWED_HEADERS, ...extraHeaders]
    : BASE_ALLOWED_HEADERS;

  const origin = req.headers.get("origin");
  const allowed = resolveOrigin(origin);

  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": allHeaders.join(", "),
  };

  if (allowed) {
    headers["Access-Control-Allow-Origin"] = allowed;
    headers["Vary"] = "Origin";
  }

  return headers;
}

/**
 * Handle an OPTIONS preflight request. Returns a 204 with CORS headers.
 */
export function handleCorsOptions(
  req: Request,
  extraHeaders?: string[],
): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(req, extraHeaders),
  });
}

/**
 * Wrap a request handler so that:
 *  1. OPTIONS preflight is handled automatically.
 *  2. CORS headers are stamped on every response.
 *
 * Usage:
 *   serve(serveCors(async (req) => { ... return jsonResponse({...}); }));
 */
export function serveCors(
  handler: (req: Request) => Promise<Response>,
  extraHeaders?: string[],
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return handleCorsOptions(req, extraHeaders);
    }

    const response = await handler(req);

    const cors = getCorsHeaders(req, extraHeaders);
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(cors)) {
      headers.set(k, v);
    }
    return new Response(response.body, { status: response.status, headers });
  };
}
