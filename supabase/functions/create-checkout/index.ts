import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2025-08-27.basil";
const VALID_DELIVERY_METHODS = new Set(["shipping", "pickup-gneis", "pickup-oslo"]);
const VALID_PAYMENT_METHODS = new Set(["card", "vipps"]);
const PICKUP_LOCATION_LABELS: Record<string, string> = {
  "pickup-gneis": "Gneis Lilleaker",
  "pickup-oslo": "Oslo Klatresenter",
};

function buildStripeApiVersion(paymentMethod: "card" | "vipps") {
  // Vipps is currently gated behind an API preview header in Stripe.
  // Stripe's Node/Deno SDK supports setting this by appending `; vipps_preview=v1`
  // to the Stripe-Version header via `apiVersion`.
  if (paymentMethod === "vipps") {
    return `${STRIPE_API_VERSION}; vipps_preview=v1` as unknown as Stripe.LatestApiVersion;
  }
  return STRIPE_API_VERSION;
}

// Edge functions typically don't ship the generated Database type; keep this untyped to avoid
// "never" inference issues during Lovable/Supabase typechecking.
type SupabaseAdmin = SupabaseClient;

type ErrorCode =
  | "INVALID_REQUEST"
  | "CONFIG_MISSING"
  | "CHECKOUT_DISABLED"
  | "PAYMENT_METHOD_UNAVAILABLE"
  | "CHECKOUT_CREATE_FAILED"
  | "SESSION_PERSIST_FAILED"
  | "INTERNAL_ERROR";

interface CheckoutItemInput {
  name: string;
  productId?: string;
  price: number;
  quantity: number;
  isDigital?: boolean;
  config?: Record<string, unknown>;
}

interface CheckoutRequest {
  items: CheckoutItemInput[];
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  deliveryMethod: string;
  shippingAddress?: {
    line1: string;
    line2?: string;
    postalCode: string;
    city: string;
  };
  promoCode?: string;
  promoDiscount: number;
  shippingAmount: number;
  paymentMethod: "card" | "vipps";
  successUrl: string;
  cancelUrl: string;
}

interface NormalizedItem {
  name: string;
  productId: string | null;
  priceNok: number;
  quantity: number;
  isDigital: boolean;
  config: Record<string, unknown> | null;
}

interface NormalizedRequest {
  items: NormalizedItem[];
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  deliveryMethod: string;
  shippingAddress:
    | {
        line1: string;
        line2: string | null;
        postalCode: string;
        city: string;
      }
    | null;
  promoCode: string | null;
  promoDiscountNok: number;
  shippingAmountNok: number;
  paymentMethod: "card" | "vipps";
  successUrl: string;
  cancelUrl: string;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function errorResponse(code: ErrorCode, message: string, status = 400): Response {
  return jsonResponse(
    {
      success: false,
      error: { code, message },
    },
    status
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asPositiveInteger(value: unknown): number | null {
  const number = asFiniteNumber(value);
  if (number === null) return null;
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

function asTrimmedString(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

function asOptionalTrimmedString(value: unknown, maxLength = 200): string | null {
  if (value === undefined || value === null) return null;
  return asTrimmedString(value, maxLength);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function toOre(valueNok: number): number {
  return Math.round(valueNok * 100);
}

function extractConfigSnapshot(item: NormalizedItem) {
  const config = item.config ?? {};
  const widths = isRecord(config.widths) ? config.widths : null;
  const heights = isRecord(config.heights) ? config.heights : null;
  const blockVariant =
    typeof config.blockVariant === "string" && (config.blockVariant === "shortedge" || config.blockVariant === "longedge")
      ? config.blockVariant
      : null;

  return {
    productId: item.productId,
    type: item.isDigital ? "file" : "printed",
    blockVariant,
    widths,
    heights,
    depth: asFiniteNumber(config.depth),
    totalWidth: asFiniteNumber(config.totalWidth),
    quantity: item.quantity,
    unitPrice: toOre(item.priceNok),
  };
}

async function getMaintenanceMode(supabaseAdmin: SupabaseAdmin) {
  const { data, error } = await supabaseAdmin
    .from("site_settings")
    .select("value")
    .eq("key", "maintenance_mode")
    .maybeSingle();

  if (error) {
    console.error("[create-checkout] Failed reading maintenance_mode setting", error);
    return { enabled: false, message: null as string | null };
  }

  const value = data?.value;
  if (!isRecord(value) || value.enabled !== true) {
    return { enabled: false, message: null as string | null };
  }

  const message =
    typeof value.message === "string" && value.message.trim()
      ? value.message.trim().slice(0, 240)
      : "Checkout is temporarily unavailable. Please try again shortly.";

  return { enabled: true, message };
}

function validateRequest(input: unknown): { ok: true; value: NormalizedRequest } | { ok: false; response: Response } {
  if (!isRecord(input)) {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "Request body must be an object.") };
  }

  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 25) {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "items must contain 1-25 elements.") };
  }

  const normalizedItems: NormalizedItem[] = [];
  for (const candidate of input.items) {
    if (!isRecord(candidate)) {
      return { ok: false, response: errorResponse("INVALID_REQUEST", "Each item must be an object.") };
    }

    const name = asTrimmedString(candidate.name, 200);
    const price = asFiniteNumber(candidate.price);
    const quantity = asPositiveInteger(candidate.quantity);

    if (!name || price === null || price <= 0 || price > 100_000 || !quantity || quantity > 100) {
      return { ok: false, response: errorResponse("INVALID_REQUEST", "Invalid item values supplied.") };
    }

    const productId = asOptionalTrimmedString(candidate.productId, 120);
    const isDigital = candidate.isDigital === true;
    const config = isRecord(candidate.config) ? candidate.config : null;

    normalizedItems.push({
      name,
      productId,
      priceNok: price,
      quantity,
      isDigital,
      config,
    });
  }

  const customerName = asTrimmedString(input.customerName, 120);
  const customerEmail = asTrimmedString(input.customerEmail, 200);
  const customerPhone = asOptionalTrimmedString(input.customerPhone, 40);
  const deliveryMethod = asTrimmedString(input.deliveryMethod, 80);
  const promoCode = asOptionalTrimmedString(input.promoCode, 80);
  const promoDiscountNok = asFiniteNumber(input.promoDiscount);
  const shippingAmountNok = asFiniteNumber(input.shippingAmount);
  const paymentMethod = asTrimmedString(input.paymentMethod, 20) as CheckoutRequest["paymentMethod"] | null;
  const successUrl = asTrimmedString(input.successUrl, 500);
  const cancelUrl = asTrimmedString(input.cancelUrl, 500);

  if (!customerName || !customerEmail || !isEmail(customerEmail)) {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "Invalid customer information.") };
  }
  if (!deliveryMethod || !VALID_DELIVERY_METHODS.has(deliveryMethod)) {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "Invalid deliveryMethod.") };
  }
  if (promoDiscountNok === null || promoDiscountNok < 0) {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "promoDiscount must be >= 0.") };
  }
  if (shippingAmountNok === null || shippingAmountNok < 0) {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "shippingAmount must be >= 0.") };
  }
  if (!paymentMethod || !VALID_PAYMENT_METHODS.has(paymentMethod)) {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "paymentMethod must be card or vipps.") };
  }
  if (!successUrl || !cancelUrl) {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "Missing successUrl/cancelUrl.") };
  }

  let parsedSuccessUrl: URL;
  let parsedCancelUrl: URL;
  try {
    parsedSuccessUrl = new URL(successUrl);
    parsedCancelUrl = new URL(cancelUrl);
  } catch {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "Invalid successUrl/cancelUrl.") };
  }
  if (parsedSuccessUrl.origin !== parsedCancelUrl.origin) {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "successUrl and cancelUrl must use same origin.") };
  }

  const hasPhysicalItems = normalizedItems.some((item) => !item.isDigital);
  let shippingAddress: NormalizedRequest["shippingAddress"] = null;
  if (deliveryMethod === "shipping" && hasPhysicalItems) {
    if (!isRecord(input.shippingAddress)) {
      return { ok: false, response: errorResponse("INVALID_REQUEST", "shippingAddress is required for shipping.") };
    }
    const line1 = asTrimmedString(input.shippingAddress.line1, 200);
    const line2 = asOptionalTrimmedString(input.shippingAddress.line2, 200);
    const postalCode = asTrimmedString(input.shippingAddress.postalCode, 20);
    const city = asTrimmedString(input.shippingAddress.city, 80);
    if (!line1 || !postalCode || !city) {
      return { ok: false, response: errorResponse("INVALID_REQUEST", "shippingAddress contains invalid fields.") };
    }
    shippingAddress = { line1, line2, postalCode, city };
  }

  const subtotalNok = normalizedItems.reduce((sum, item) => sum + item.priceNok * item.quantity, 0);
  const totalNok = subtotalNok + shippingAmountNok - promoDiscountNok;
  if (subtotalNok <= 0 || totalNok <= 0) {
    return {
      ok: false,
      response: errorResponse(
        "INVALID_REQUEST",
        "Computed total must be greater than zero. Use free-order flow for 100% discount."
      ),
    };
  }

  return {
    ok: true,
    value: {
      items: normalizedItems,
      customerName,
      customerEmail,
      customerPhone,
      deliveryMethod,
      shippingAddress,
      promoCode,
      promoDiscountNok,
      shippingAmountNok,
      paymentMethod,
      successUrl: parsedSuccessUrl.toString(),
      cancelUrl: parsedCancelUrl.toString(),
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
    return errorResponse("CONFIG_MISSING", "Server configuration is incomplete.", 500);
  }

  let checkoutRef: string | null = null;
  const supabaseAdmin: SupabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
  try {
    const payload = await req.json();
    const validation = validateRequest(payload);
    if (!validation.ok) return validation.response;

    const input = validation.value;
    const maintenanceMode = await getMaintenanceMode(supabaseAdmin);
    if (maintenanceMode.enabled) {
      return errorResponse(
        "CHECKOUT_DISABLED",
        maintenanceMode.message ?? "Checkout is temporarily unavailable. Please try again shortly.",
        503
      );
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: buildStripeApiVersion(input.paymentMethod) });

    checkoutRef = crypto.randomUUID();

    const subtotalAmountOre = input.items.reduce((sum, item) => sum + toOre(item.priceNok) * item.quantity, 0);
    const shippingAmountOre = toOre(input.shippingAmountNok);
    const promoDiscountOre = toOre(input.promoDiscountNok);
    const totalAmountOre = subtotalAmountOre + shippingAmountOre - promoDiscountOre;

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = input.items.map((item) => ({
      price_data: {
        currency: "nok",
        product_data: { name: item.name },
        unit_amount: toOre(item.priceNok),
      },
      quantity: item.quantity,
    }));

    if (shippingAmountOre > 0) {
      lineItems.push({
        price_data: {
          currency: "nok",
          product_data: { name: "Frakt" },
          unit_amount: shippingAmountOre,
        },
        quantity: 1,
      });
    }

    const discountList: Stripe.Checkout.SessionCreateParams.Discount[] = [];
    if (promoDiscountOre > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: promoDiscountOre,
        currency: "nok",
        duration: "once",
        name: input.promoCode ?? "Rabatt",
      });
      discountList.push({ coupon: coupon.id });
    }

    const orderLineItems = input.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: toOre(item.priceNok),
      productId: item.productId,
    }));

    const configSnapshot = {
      version: 1,
      items: input.items.map(extractConfigSnapshot),
      promoCode: input.promoCode,
      promoDiscount: promoDiscountOre,
    };

    const pickupLocation =
      input.deliveryMethod in PICKUP_LOCATION_LABELS
        ? PICKUP_LOCATION_LABELS[input.deliveryMethod]
        : null;

    const { error: insertError } = await supabaseAdmin.from("checkout_sessions").insert({
      id: checkoutRef,
      status: "pending",
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone,
      delivery_method: input.deliveryMethod,
      pickup_location: pickupLocation,
      shipping_address: input.shippingAddress,
      promo_code: input.promoCode,
      promo_discount_amount: promoDiscountOre,
      subtotal_amount: subtotalAmountOre,
      shipping_amount: shippingAmountOre,
      total_amount: totalAmountOre,
      currency: "NOK",
      line_items: orderLineItems,
      config_snapshot: configSnapshot,
      error_message: null,
    });

    if (insertError) {
      console.error("[create-checkout] Failed storing checkout snapshot", insertError);
      return errorResponse("SESSION_PERSIST_FAILED", "Could not persist checkout session.", 500);
    }

    const paymentMethodTypes: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] =
      input.paymentMethod === "vipps" ? ["card", "vipps"] : ["card"];

    const session = await stripe.checkout.sessions.create({
      client_reference_id: checkoutRef,
      customer_email: input.customerEmail,
      line_items: lineItems,
      mode: "payment",
      phone_number_collection: input.paymentMethod === "vipps" ? { enabled: true } : undefined,
      success_url: `${input.successUrl}${input.successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: input.cancelUrl,
      payment_method_types: paymentMethodTypes,
      locale: "nb",
      metadata: {
        checkout_ref: checkoutRef,
        delivery_method: input.deliveryMethod,
      },
      discounts: discountList.length > 0 ? discountList : undefined,
    });

    const { error: updateError } = await supabaseAdmin
      .from("checkout_sessions")
      .update({
        stripe_checkout_session_id: session.id,
        status: "pending",
        error_message: null,
      })
      .eq("id", checkoutRef);

    if (updateError) {
      console.error("[create-checkout] Created Stripe session but failed updating checkout snapshot", {
        checkoutRef,
        sessionId: session.id,
        updateError,
      });
      return errorResponse("SESSION_PERSIST_FAILED", "Checkout session created but persistence failed.", 500);
    }

    return jsonResponse({
      success: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const stripeError = error as Stripe.errors.StripeError;

    if (checkoutRef) {
      await supabaseAdmin
        .from("checkout_sessions")
        .update({
          status: "failed",
          error_message: message,
        })
        .eq("id", checkoutRef);
    }

    if (stripeError?.type === "StripeInvalidRequestError") {
      const isPaymentMethodError =
        stripeError.message?.toLowerCase().includes("payment_method") ||
        stripeError.message?.toLowerCase().includes("vipps");

      if (isPaymentMethodError) {
        return errorResponse("PAYMENT_METHOD_UNAVAILABLE", stripeError.message, 400);
      }

      return errorResponse("CHECKOUT_CREATE_FAILED", stripeError.message, 400);
    }

    console.error("[create-checkout] Unexpected error", error);
    return errorResponse("INTERNAL_ERROR", message, 500);
  }
});
