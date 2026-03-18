import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { serveCors } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/timing.ts";
import {
  enforceRateLimit,
  readJsonBody,
  secureErrorResponse,
  secureJsonResponse,
} from "../_shared/security.ts";

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2025-08-27.basil";
const ORDER_STATUS_SECRET = Deno.env.get("ORDER_STATUS_SECRET");

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function computeCheckoutToken(secret: string, sessionId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(sessionId));
  return toBase64Url(new Uint8Array(sig));
}

serve(serveCors(async (req) => {
  if (req.method !== "POST") {
    return secureErrorResponse("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");

  if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey || !ORDER_STATUS_SECRET) {
    return secureErrorResponse("CONFIG_MISSING", "Server configuration is incomplete.", 500);
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const rateLimitResponse = await enforceRateLimit({
      req,
      supabaseAdmin,
      rateLimitSecret,
      route: "verify-session",
      limit: 10,
      windowSeconds: 600,
      auditEventType: "status.rate_limited",
    });
    if (rateLimitResponse) return rateLimitResponse;

    const parsedBody = await readJsonBody<Record<string, unknown>>(req, 2 * 1024);
    if ("response" in parsedBody) return parsedBody.response;

    const body = parsedBody.data;
    if (!isRecord(body) || typeof body.sessionId !== "string" || !body.sessionId.trim()) {
      return secureErrorResponse("INVALID_REQUEST", "sessionId is required.", 400);
    }

    const sessionId = body.sessionId.trim();
    const token = req.headers.get("x-checkout-token")?.trim() ?? "";
    if (!token) {
      return secureErrorResponse("MISSING_TOKEN", "Missing checkout token.", 401);
    }

    const expected = await computeCheckoutToken(ORDER_STATUS_SECRET, sessionId);
    if (!timingSafeEqual(token, expected)) {
      return secureErrorResponse("UNAUTHORIZED", "Invalid checkout token.", 403);
    }

    const { data: checkoutSession } = await supabaseAdmin
      .from("checkout_sessions")
      .select("id,status,order_id,stripe_checkout_session_id,stripe_payment_intent_id")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();

    if (checkoutSession && ["paid", "expired", "failed"].includes(checkoutSession.status)) {
      const paid = checkoutSession.status === "paid";
      return secureJsonResponse({
        success: true,
        sessionId,
        paid,
        paymentStatus: paid ? "paid" : checkoutSession.status,
        checkoutStatus: checkoutSession.status,
        orderId: checkoutSession.order_id ?? null,
        stripePaymentIntentId: checkoutSession.stripe_payment_intent_id ?? null,
      });
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
    const paid = session.payment_status === "paid";

    if (checkoutSession && paid && checkoutSession.status !== "paid") {
      await supabaseAdmin
        .from("checkout_sessions")
        .update({
          status: "paid",
          stripe_payment_intent_id: paymentIntentId,
          error_message: null,
        })
        .eq("id", checkoutSession.id);
    }

    return secureJsonResponse({
      success: true,
      sessionId: session.id,
      paid,
      paymentStatus: session.payment_status,
      checkoutStatus: checkoutSession?.status ?? null,
      orderId: checkoutSession?.order_id ?? null,
      stripePaymentIntentId: paymentIntentId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[verify-session] Error:", message);
    return secureErrorResponse("VERIFY_FAILED", "Could not verify session.", 500);
  }
}, ["x-checkout-token"]));
