import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { serveCors } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/timing.ts";

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2025-08-27.basil";
const ORDER_STATUS_SECRET = Deno.env.get("ORDER_STATUS_SECRET");

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

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
    return jsonResponse(
      { success: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      405
    );
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey || !ORDER_STATUS_SECRET) {
    return jsonResponse(
      {
        success: false,
        error: { code: "CONFIG_MISSING", message: "Server configuration is incomplete." },
      },
      500
    );
  }

  try {
    const body = await req.json();
    if (!isRecord(body) || typeof body.sessionId !== "string" || !body.sessionId.trim()) {
      return jsonResponse(
        { success: false, error: { code: "INVALID_REQUEST", message: "sessionId is required." } },
        400
      );
    }

    const sessionId = body.sessionId.trim();
    const token = req.headers.get("x-checkout-token")?.trim() ?? "";
    if (!token) {
      return jsonResponse(
        { success: false, error: { code: "MISSING_TOKEN", message: "Missing checkout token." } },
        401
      );
    }

    const expected = await computeCheckoutToken(ORDER_STATUS_SECRET, sessionId);
    if (!timingSafeEqual(token, expected)) {
      return jsonResponse(
        { success: false, error: { code: "UNAUTHORIZED", message: "Invalid checkout token." } },
        403
      );
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
    const paid = session.payment_status === "paid";

    const { data: checkoutSession } = await supabaseAdmin
      .from("checkout_sessions")
      .select("id,status,order_id,stripe_checkout_session_id,stripe_payment_intent_id")
      .eq("stripe_checkout_session_id", session.id)
      .maybeSingle();

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

    return jsonResponse({
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
    return jsonResponse(
      {
        success: false,
        error: { code: "VERIFY_FAILED", message: "Could not verify session." },
      },
      500
    );
  }
}, ["x-checkout-token"]));
