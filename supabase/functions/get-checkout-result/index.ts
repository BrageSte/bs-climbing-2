import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { serveCors } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/timing.ts";

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
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey || !ORDER_STATUS_SECRET) {
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
        {
          success: false,
          error: { code: "INVALID_REQUEST", message: "sessionId is required." },
        },
        400
      );
    }

    const sessionId = body.sessionId.trim();

    // Verify the caller holds the HMAC token we issued for this session.
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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: checkoutSession, error: checkoutError } = await supabaseAdmin
      .from("checkout_sessions")
      .select(
        "id, status, order_id, customer_name, customer_email, customer_phone, " +
        "delivery_method, pickup_location, shipping_address, " +
        "line_items, config_snapshot, " +
        "subtotal_amount, shipping_amount, total_amount, currency, " +
        "promo_code, promo_discount_amount"
      )
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();

    if (checkoutError) {
      console.error("[get-checkout-result] Failed loading checkout_sessions", {
        code: checkoutError.code,
        message: checkoutError.message,
      });
      return jsonResponse(
        {
          success: false,
          error: { code: "DB_ERROR", message: "Database error." },
        },
        500
      );
    }

    if (!checkoutSession) {
      return jsonResponse({
        success: true,
        status: "pending",
        checkout: null,
      });
    }

    if (checkoutSession.status === "expired") {
      return jsonResponse({
        success: true,
        status: "expired",
        checkout: checkoutSession,
      });
    }

    if (checkoutSession.status === "failed") {
      return jsonResponse({
        success: true,
        status: "failed",
        checkout: checkoutSession,
      });
    }

    if (!checkoutSession.order_id) {
      return jsonResponse({
        success: true,
        status: "pending",
        checkout: checkoutSession,
      });
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select(
        "id, created_at, status, customer_name, customer_email, customer_phone, " +
        "delivery_method, pickup_location, shipping_address, " +
        "line_items, config_snapshot, " +
        "subtotal_amount, shipping_amount, total_amount, currency, " +
        "stripe_checkout_session_id, production_number"
      )
      .eq("id", checkoutSession.order_id)
      .maybeSingle();

    if (orderError) {
      console.error("[get-checkout-result] Failed loading orders", {
        code: orderError.code,
        message: orderError.message,
        orderId: checkoutSession.order_id,
      });
      return jsonResponse(
        {
          success: false,
          error: { code: "DB_ERROR", message: "Database error." },
        },
        500
      );
    }

    if (!order) {
      return jsonResponse({
        success: true,
        status: "pending",
        checkout: checkoutSession,
      });
    }

    return jsonResponse({
      success: true,
      status: "paid",
      checkout: checkoutSession,
      order,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[get-checkout-result] Unexpected error", message);
    return jsonResponse(
      {
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Internal error." },
      },
      500
    );
  }
}, ["x-checkout-token"]));
