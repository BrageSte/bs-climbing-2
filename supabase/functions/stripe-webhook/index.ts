import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// Edge functions typically don't ship the generated Database type; keep this untyped to avoid
// "never" inference issues during Lovable/Supabase typechecking.
type SupabaseAdmin = SupabaseClient;

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2025-08-27.basil";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, stripe-signature",
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

function parseLineItems(lineItems: unknown): Array<{ name: string; quantity: number; price: number }> {
  if (!Array.isArray(lineItems)) return [];

  return lineItems
    .map((lineItem) => {
      if (!isRecord(lineItem)) return null;
      const name = typeof lineItem.name === "string" ? lineItem.name : null;
      const quantity = typeof lineItem.quantity === "number" ? lineItem.quantity : null;
      const price = typeof lineItem.price === "number" ? lineItem.price : null;

      if (!name || !quantity || quantity <= 0 || !price || price <= 0) return null;
      return { name, quantity, price: Math.round(price / 100) };
    })
    .filter((lineItem): lineItem is { name: string; quantity: number; price: number } => lineItem !== null);
}

async function logOrderEvent(
  supabaseAdmin: SupabaseAdmin,
  eventType: string,
  payload: Record<string, unknown>,
  orderId: string | null
) {
  const { error } = await supabaseAdmin.from("order_events").insert({
    order_id: orderId,
    event_type: eventType,
    payload,
  });

  if (error) {
    console.error("[stripe-webhook] Failed writing order_events", { eventType, orderId, error });
  }
}

async function findCheckoutSession(
  supabaseAdmin: SupabaseAdmin,
  session: Stripe.Checkout.Session
) {
  const checkoutRef = session.client_reference_id ?? session.metadata?.checkout_ref ?? null;
  if (checkoutRef) {
    const byRef = await supabaseAdmin.from("checkout_sessions").select("*").eq("id", checkoutRef).maybeSingle();
    if (byRef.data) return byRef.data;
  }

  const byStripeSessionId = await supabaseAdmin
    .from("checkout_sessions")
    .select("*")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();

  return byStripeSessionId.data;
}

async function persistOrderForPaidSession(
  supabaseAdmin: SupabaseAdmin,
  session: Stripe.Checkout.Session,
  checkoutSession: Record<string, unknown>
) {
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const existingOrder = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();

  if (existingOrder.data) {
    return { order: existingOrder.data, paymentIntentId };
  }

  const insertPayload = {
    customer_name: checkoutSession.customer_name as string,
    customer_email: checkoutSession.customer_email as string,
    customer_phone: (checkoutSession.customer_phone as string | null) ?? null,
    delivery_method: checkoutSession.delivery_method as string,
    pickup_location: (checkoutSession.pickup_location as string | null) ?? null,
    shipping_address: checkoutSession.shipping_address ?? null,
    line_items: checkoutSession.line_items,
    config_snapshot: checkoutSession.config_snapshot,
    subtotal_amount: checkoutSession.subtotal_amount as number,
    shipping_amount: checkoutSession.shipping_amount as number,
    total_amount: checkoutSession.total_amount as number,
    currency: (checkoutSession.currency as string) ?? "NOK",
    status: "new",
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
  };

  const insertedOrder = await supabaseAdmin.from("orders").insert(insertPayload).select("*").maybeSingle();

  if (!insertedOrder.error && insertedOrder.data) {
    return { order: insertedOrder.data, paymentIntentId };
  }

  if (insertedOrder.error?.code === "23505") {
    const raceOrder = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("stripe_checkout_session_id", session.id)
      .maybeSingle();

    if (raceOrder.data) {
      return { order: raceOrder.data, paymentIntentId };
    }
  }

  throw insertedOrder.error ?? new Error("Could not create order from paid Stripe session.");
}

async function sendOrderConfirmationEmail(
  supabaseAdmin: SupabaseAdmin,
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  checkoutSession: Record<string, unknown>,
  order: Record<string, unknown>
) {
  const alreadySentAt = checkoutSession.confirmation_email_sent_at;
  if (alreadySentAt) return;

  const response = await fetch(`${supabaseUrl}/functions/v1/send-order-confirmation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      apikey: supabaseServiceRoleKey,
    },
    body: JSON.stringify({ orderId: order.id as string }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    console.error("[stripe-webhook] Failed sending confirmation email", {
      status: response.status,
      responseText,
      orderId: order.id,
    });
    return;
  }

  const { error } = await supabaseAdmin
    .from("checkout_sessions")
    .update({ confirmation_email_sent_at: new Date().toISOString() })
    .eq("id", checkoutSession.id as string);

  if (error) {
    console.error("[stripe-webhook] Failed updating confirmation_email_sent_at", {
      checkoutId: checkoutSession.id,
      error,
    });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecretKey || !stripeWebhookSecret || !supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse({ success: false, error: "Webhook configuration missing." }, 500);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return jsonResponse({ success: false, error: "Missing Stripe signature." }, 400);
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
  const supabaseAdmin: SupabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  const bodyText = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(bodyText, signature, stripeWebhookSecret);
  } catch (error) {
    console.error("[stripe-webhook] Signature verification failed", error);
    return jsonResponse({ success: false, error: "Invalid Stripe signature." }, 400);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const checkoutSession = await findCheckoutSession(supabaseAdmin, session);

      if (!checkoutSession) {
        console.error("[stripe-webhook] checkout.session.completed without checkout_session row", {
          stripeSessionId: session.id,
          checkoutRef: session.client_reference_id,
        });
        return jsonResponse({ success: true, ignored: true });
      }

      const { order, paymentIntentId } = await persistOrderForPaidSession(
        supabaseAdmin,
        session,
        checkoutSession
      );

      const { error: checkoutUpdateError } = await supabaseAdmin
        .from("checkout_sessions")
        .update({
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: paymentIntentId,
          status: "paid",
          order_id: order.id,
          error_message: null,
        })
        .eq("id", checkoutSession.id as string);

      if (checkoutUpdateError) {
        console.error("[stripe-webhook] Failed updating checkout_sessions after payment", {
          checkoutId: checkoutSession.id,
          checkoutUpdateError,
        });
      }

      await logOrderEvent(
        supabaseAdmin,
        "stripe.checkout.session.completed",
        {
          stripeEventId: event.id,
          stripeSessionId: session.id,
          checkoutRef: session.client_reference_id,
          paymentIntentId,
        },
        order.id as string
      );

      await sendOrderConfirmationEmail(
        supabaseAdmin,
        supabaseUrl,
        supabaseServiceRoleKey,
        checkoutSession,
        order
      );

      return jsonResponse({ success: true });
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const checkoutSession = await findCheckoutSession(supabaseAdmin, session);

      if (checkoutSession) {
        const { error } = await supabaseAdmin
          .from("checkout_sessions")
          .update({
            stripe_checkout_session_id: session.id,
            status: "expired",
            error_message: "Stripe session expired before payment.",
          })
          .eq("id", checkoutSession.id as string);

        if (error) {
          console.error("[stripe-webhook] Failed marking checkout as expired", {
            checkoutId: checkoutSession.id,
            error,
          });
        }

        await logOrderEvent(
          supabaseAdmin,
          "stripe.checkout.session.expired",
          {
            stripeEventId: event.id,
            stripeSessionId: session.id,
            checkoutRef: session.client_reference_id,
          },
          (checkoutSession.order_id as string | null) ?? null
        );
      }

      return jsonResponse({ success: true });
    }

    return jsonResponse({ success: true, ignored: true, eventType: event.type });
  } catch (error) {
    console.error("[stripe-webhook] Handler error", { eventType: event.type, error });
    return jsonResponse({ success: false, error: "Webhook handler failed." }, 500);
  }
});
