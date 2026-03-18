const JSON_SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
};

type MinimalSupabaseClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  from: (
    table: string,
  ) => {
    insert: (value: Record<string, unknown>) => Promise<{ error: { code?: string; message?: string } | null }>;
  };
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

interface AuditEventInput {
  eventType: string;
  route?: string;
  subjectHash?: string;
  orderId?: string | null;
  payload?: Record<string, unknown>;
}

interface RateLimitInput {
  req: Request;
  supabaseAdmin: MinimalSupabaseClient;
  rateLimitSecret: string | null;
  route: string;
  limit: number;
  windowSeconds: number;
  auditEventType: string;
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return null;
}

function encodeBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function secureJsonResponse(
  payload: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...JSON_SECURITY_HEADERS,
      ...(extraHeaders ?? {}),
    },
  });
}

export function secureErrorResponse(
  code: string,
  message: string,
  status: number,
  extras?: Record<string, unknown>,
): Response {
  return secureJsonResponse(
    {
      success: false,
      error: { code, message },
      ...(extras ?? {}),
    },
    status,
  );
}

export function parseContentLength(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

export async function readJsonBody<T>(
  req: Request,
  maxBytes: number,
): Promise<{ data: T; rawText: string } | { response: Response }> {
  const declaredLength = parseContentLength(req.headers.get("content-length"));
  if (declaredLength !== null && declaredLength > maxBytes) {
    return {
      response: secureErrorResponse(
        "REQUEST_TOO_LARGE",
        `Request body exceeds ${maxBytes} bytes.`,
        413,
      ),
    };
  }

  const rawText = await req.text();
  const actualLength = new TextEncoder().encode(rawText).length;
  if (actualLength > maxBytes) {
    return {
      response: secureErrorResponse(
        "REQUEST_TOO_LARGE",
        `Request body exceeds ${maxBytes} bytes.`,
        413,
      ),
    };
  }

  try {
    return {
      data: JSON.parse(rawText) as T,
      rawText,
    };
  } catch {
    return {
      response: secureErrorResponse(
        "INVALID_REQUEST",
        "Request body must be valid JSON.",
        400,
      ),
    };
  }
}

export function extractClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  const cfIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

export async function createRateLimitFingerprint(
  secret: string,
  route: string,
  clientIp: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${route}:${clientIp}`),
  );

  return encodeBase64Url(new Uint8Array(signature));
}

export function normalizeRateLimitResult(raw: unknown): RateLimitResult | null {
  const record = Array.isArray(raw) ? raw[0] : raw;
  if (!record || typeof record !== "object") return null;

  const value = record as Record<string, unknown>;
  const allowed = typeof value.allowed === "boolean" ? value.allowed : null;
  const remaining = asPositiveInteger(value.remaining);
  const retryAfterSeconds =
    "retry_after_seconds" in value
      ? asPositiveInteger(value.retry_after_seconds)
      : "retryAfterSeconds" in value
        ? asPositiveInteger(value.retryAfterSeconds)
        : null;

  if (typeof allowed !== "boolean" || remaining === null || retryAfterSeconds === null) {
    return null;
  }

  return {
    allowed,
    remaining,
    retryAfterSeconds,
  };
}

export async function writeAuditEvent(
  supabaseAdmin: MinimalSupabaseClient,
  input: AuditEventInput,
): Promise<void> {
  const { error } = await supabaseAdmin.from("audit_events").insert({
    event_type: input.eventType,
    route: input.route ?? null,
    subject_hash: input.subjectHash ?? null,
    order_id: input.orderId ?? null,
    payload: input.payload ?? {},
  });

  if (error) {
    console.error("[security] Failed writing audit_events", {
      eventType: input.eventType,
      route: input.route,
      error,
    });
  }
}

export async function enforceRateLimit(input: RateLimitInput): Promise<Response | null> {
  if (!input.rateLimitSecret?.trim()) {
    return secureErrorResponse(
      "SECURITY_CONFIG_MISSING",
      "Server security configuration is incomplete.",
      500,
    );
  }

  const subjectHash = await createRateLimitFingerprint(
    input.rateLimitSecret,
    input.route,
    extractClientIp(input.req),
  );

  const { data, error } = await input.supabaseAdmin.rpc("consume_edge_rate_limit", {
    p_route: input.route,
    p_fingerprint: subjectHash,
    p_limit: input.limit,
    p_window_seconds: input.windowSeconds,
  });

  if (error) {
    console.error("[security] Failed consuming edge rate limit", {
      route: input.route,
      code: error.code,
      message: error.message,
    });
    return secureErrorResponse(
      "INTERNAL_ERROR",
      "Could not verify request limits.",
      500,
    );
  }

  const result = normalizeRateLimitResult(data);
  if (!result) {
    console.error("[security] Unexpected rate limit RPC shape", {
      route: input.route,
      data,
    });
    return secureErrorResponse(
      "INTERNAL_ERROR",
      "Could not verify request limits.",
      500,
    );
  }

  if (result.allowed) {
    return null;
  }

  await writeAuditEvent(input.supabaseAdmin, {
    eventType: input.auditEventType,
    route: input.route,
    subjectHash,
    payload: {
      limit: input.limit,
      retryAfterSeconds: result.retryAfterSeconds,
      windowSeconds: input.windowSeconds,
    },
  });

  return secureErrorResponse(
    "RATE_LIMITED",
    "Too many requests. Please wait before trying again.",
    429,
    { retryAfterSeconds: result.retryAfterSeconds },
  );
}
