import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey) {
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
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: checkoutSession, error: checkoutError } = await supabaseAdmin
      .from("checkout_sessions")
      .select("*")
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
      .select("*")
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
});
