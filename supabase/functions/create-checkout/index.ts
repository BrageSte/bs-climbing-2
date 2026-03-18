import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { serveCors } from "../_shared/cors.ts";
import {
  enforceRateLimit,
  readJsonBody,
  secureJsonResponse,
} from "../_shared/security.ts";

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2025-08-27.basil";
const ORDER_STATUS_SECRET = Deno.env.get("ORDER_STATUS_SECRET");
const VALID_DELIVERY_METHODS = new Set(["shipping", "pickup-gneis", "pickup-oslo"]);
const VALID_PAYMENT_METHODS = new Set(["card", "vipps"]);
const PICKUP_LOCATION_LABELS: Record<string, string> = {
  "pickup-gneis": "Gneis Lilleaker",
  "pickup-oslo": "Oslo Klatresenter",
};
const BLOCK_VARIANT_LABELS: Record<"shortedge" | "longedge", string> = {
  shortedge: "Compact",
  longedge: "Long Edge",
};

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
  | "INVALID_PROMO"
  | "CONFIG_MISSING"
  | "CHECKOUT_DISABLED"
  | "PAYMENT_METHOD_UNAVAILABLE"
  | "CHECKOUT_CREATE_FAILED"
  | "SESSION_PERSIST_FAILED"
  | "INTERNAL_ERROR";

interface CheckoutItemInput {
  name: string;
  productId?: string;
  quantity: number;
  isDigital?: boolean;
  config?: Record<string, unknown>;
  // Backwards compatible: frontend may send price, but we do not trust it.
  price?: number;
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
    postal_code?: string;
    city: string;
  };
  promoCode?: string;
  paymentMethod: "card" | "vipps";
  successUrl: string;
  cancelUrl: string;
}

interface NormalizedItem {
  name: string;
  productId: string | null;
  quantity: number;
  isDigital: boolean;
  blockVariant: "shortedge" | "longedge";
  config: Record<string, unknown>;
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
  paymentMethod: "card" | "vipps";
  successUrl: string;
  cancelUrl: string;
}

type PromoCodeRule = { type: "percent" | "fixed"; value: number };
type ProductPriceByVariant = { shortedge: number; longedge: number };

function jsonResponse(payload: unknown, status = 200): Response {
  return secureJsonResponse(payload, status);
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
  // NOTE: This is a regex literal, so we must not double-escape `\s` / `\.`.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function toOre(valueNok: number): number {
  return Math.round(valueNok * 100);
}

function parseBlockVariant(config: Record<string, unknown>): "shortedge" | "longedge" | null {
  const candidate = config.blockVariant;
  return candidate === "shortedge" || candidate === "longedge" ? candidate : null;
}

function sanitizePromoCodes(value: unknown): Record<string, PromoCodeRule> {
  if (!isRecord(value)) return {};
  const sanitized: Record<string, PromoCodeRule> = {};

  for (const [rawCode, rawRule] of Object.entries(value)) {
    const code = rawCode.trim().toUpperCase();
    if (!code) continue;
    if (!isRecord(rawRule)) continue;

    const type = rawRule.type;
    const amount = asFiniteNumber(rawRule.value);
    if ((type !== "percent" && type !== "fixed") || amount === null) continue;

    if (type === "percent") {
      const percent = Math.round(amount);
      if (percent <= 0 || percent > 100) continue;
      sanitized[code] = { type: "percent", value: percent };
      continue;
    }

    const fixed = Math.round(amount);
    if (fixed <= 0) continue;
    sanitized[code] = { type: "fixed", value: fixed };
  }

  return sanitized;
}

function sanitizeProducts(value: unknown): ProductPriceByVariant {
  const defaults: ProductPriceByVariant = { shortedge: 399, longedge: 499 };
  if (!Array.isArray(value)) return defaults;

  const result: ProductPriceByVariant = { ...defaults };
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const variant = candidate.variant;
    const price = asFiniteNumber(candidate.price);
    if ((variant === "shortedge" || variant === "longedge") && price !== null && price > 0 && price < 100_000) {
      result[variant] = Math.round(price);
    }
  }
  return result;
}

function sanitizeStlFilePrice(value: unknown): number {
  const parsed = asFiniteNumber(value);
  if (parsed === null || parsed <= 0 || parsed >= 100_000) return 199;
  return Math.round(parsed);
}

function sanitizeShippingCost(value: unknown): number {
  const parsed = asFiniteNumber(value);
  if (parsed === null || parsed < 0 || parsed >= 100_000) return 79;
  return Math.round(parsed);
}

function sanitizeMaintenanceMode(value: unknown): { enabled: boolean; message: string | null } {
  if (!isRecord(value) || value.enabled !== true) return { enabled: false, message: null };
  const message =
    typeof value.message === "string" && value.message.trim()
      ? value.message.trim().slice(0, 240)
      : "Checkout is temporarily unavailable. Please try again shortly.";
  return { enabled: true, message };
}

async function loadCheckoutSettings(supabaseAdmin: SupabaseAdmin) {
  const keys = ["products", "stl_file_price", "shipping_cost", "promo_codes", "maintenance_mode"];
  const { data, error } = await supabaseAdmin.from("site_settings").select("key,value").in("key", keys);

  if (error) {
    console.error("[create-checkout] Failed loading site_settings", { code: error.code, message: error.message });
    return {
      products: { shortedge: 399, longedge: 499 } as ProductPriceByVariant,
      stlFilePrice: 199,
      shippingCost: 79,
      promoCodes: {} as Record<string, PromoCodeRule>,
      maintenanceMode: { enabled: false, message: null as string | null },
    };
  }

  const rows = Array.isArray(data) ? data : [];
  const byKey = new Map<string, unknown>();
  rows.forEach((row) => {
    if (row && typeof row.key === "string") byKey.set(row.key, row.value);
  });

  return {
    products: sanitizeProducts(byKey.get("products")),
    stlFilePrice: sanitizeStlFilePrice(byKey.get("stl_file_price")),
    shippingCost: sanitizeShippingCost(byKey.get("shipping_cost")),
    promoCodes: sanitizePromoCodes(byKey.get("promo_codes")),
    maintenanceMode: sanitizeMaintenanceMode(byKey.get("maintenance_mode")),
  };
}

function computeDiscountNok(
  promoCodeRaw: string | null,
  promoCodes: Record<string, PromoCodeRule>,
  preDiscountTotalNok: number
): { ok: true; promoCode: string | null; discountNok: number } | { ok: false; error: string } {
  if (!promoCodeRaw) return { ok: true, promoCode: null, discountNok: 0 };

  const promoCode = promoCodeRaw.trim().toUpperCase();
  if (!promoCode) return { ok: true, promoCode: null, discountNok: 0 };

  const rule = promoCodes[promoCode];
  if (!rule) {
    return { ok: false, error: "Ugyldig promokode." };
  }

  const total = Math.max(0, Math.round(preDiscountTotalNok));
  if (total <= 0) return { ok: true, promoCode, discountNok: 0 };

  const discount =
    rule.type === "percent"
      ? Math.round(total * (rule.value / 100))
      : Math.min(Math.round(rule.value), total);

  return { ok: true, promoCode, discountNok: Math.max(0, Math.min(discount, total)) };
}

function computeShippingNok(deliveryMethod: string, hasPhysicalItems: boolean, shippingCost: number): number {
  if (!hasPhysicalItems) return 0;
  if (deliveryMethod === "pickup-gneis" || deliveryMethod === "pickup-oslo") return 0;
  if (deliveryMethod === "shipping") return Math.max(0, Math.round(shippingCost));
  return 0;
}

function extractConfigSnapshot(item: NormalizedItem, unitPriceOre: number) {
  const widths = isRecord(item.config.widths) ? item.config.widths : null;
  const heights = isRecord(item.config.heights) ? item.config.heights : null;
  const blockVariant = parseBlockVariant(item.config);

  return {
    productId: item.productId,
    type: item.isDigital ? "file" : "printed",
    blockVariant,
    widths,
    heights,
    depth: asFiniteNumber(item.config.depth),
    totalWidth: asFiniteNumber(item.config.totalWidth),
    quantity: item.quantity,
    unitPrice: unitPriceOre,
  };
}

function getConfiguredSiteOrigin(): { ok: true; origin: string } | { ok: false; response: Response } {
  const siteUrl = Deno.env.get("PUBLIC_SITE_URL")?.trim();
  if (!siteUrl) {
    return {
      ok: false,
      response: errorResponse("CONFIG_MISSING", "PUBLIC_SITE_URL is not configured.", 500),
    };
  }

  try {
    return { ok: true, origin: new URL(siteUrl).origin };
  } catch {
    return {
      ok: false,
      response: errorResponse("CONFIG_MISSING", "PUBLIC_SITE_URL is invalid.", 500),
    };
  }
}

function validateRequest(
  input: unknown,
  allowedOrigin: string,
): { ok: true; value: NormalizedRequest } | { ok: false; response: Response } {
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
    const quantity = asPositiveInteger(candidate.quantity);
    const productId = asOptionalTrimmedString(candidate.productId, 120);
    const isDigital = candidate.isDigital === true;
    const config = isRecord(candidate.config) ? candidate.config : null;

    if (!name || !quantity || quantity > 100) {
      return { ok: false, response: errorResponse("INVALID_REQUEST", "Invalid item values supplied.") };
    }
    if (!config) {
      return { ok: false, response: errorResponse("INVALID_REQUEST", "Item config is required.") };
    }
    const blockVariant = parseBlockVariant(config);
    if (!blockVariant) {
      return { ok: false, response: errorResponse("INVALID_REQUEST", "Invalid blockVariant supplied.") };
    }

    normalizedItems.push({
      name,
      productId,
      quantity,
      isDigital,
      blockVariant,
      config,
    });
  }

  const customerName = asTrimmedString(input.customerName, 120);
  const customerEmail = asTrimmedString(input.customerEmail, 200);
  const customerPhone = asOptionalTrimmedString(input.customerPhone, 40);
  const deliveryMethod = asTrimmedString(input.deliveryMethod, 80);
  const promoCode = asOptionalTrimmedString(input.promoCode, 80);
  const paymentMethod = asTrimmedString(input.paymentMethod, 20) as CheckoutRequest["paymentMethod"] | null;
  const successUrl = asTrimmedString(input.successUrl, 500);
  const cancelUrl = asTrimmedString(input.cancelUrl, 500);

  if (!customerName || !customerEmail || !isEmail(customerEmail)) {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "Invalid customer information.") };
  }
  if (!deliveryMethod || !VALID_DELIVERY_METHODS.has(deliveryMethod)) {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "Invalid deliveryMethod.") };
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
  if (parsedSuccessUrl.origin !== allowedOrigin) {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "successUrl must use the configured site origin.") };
  }

  const hasPhysicalItems = normalizedItems.some((item) => !item.isDigital);
  let shippingAddress: NormalizedRequest["shippingAddress"] = null;
  if (deliveryMethod === "shipping" && hasPhysicalItems) {
    if (!isRecord(input.shippingAddress)) {
      return { ok: false, response: errorResponse("INVALID_REQUEST", "shippingAddress is required for shipping.") };
    }
    const line1 = asTrimmedString(input.shippingAddress.line1, 200);
    const line2 = asOptionalTrimmedString(input.shippingAddress.line2, 200);
    const postalCode = asTrimmedString(
      input.shippingAddress.postalCode ?? input.shippingAddress.postal_code,
      20,
    );
    const city = asTrimmedString(input.shippingAddress.city, 80);
    if (!line1 || !postalCode || !city) {
      return { ok: false, response: errorResponse("INVALID_REQUEST", "shippingAddress contains invalid fields.") };
    }
    shippingAddress = { line1, line2, postalCode, city };
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
      paymentMethod,
      successUrl: parsedSuccessUrl.toString(),
      cancelUrl: parsedCancelUrl.toString(),
    },
  };
}

async function sendOrderConfirmationEmail(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  orderId: string
): Promise<boolean> {
  const response = await fetch(`${supabaseUrl}/functions/v1/send-order-confirmation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      apikey: supabaseServiceRoleKey,
    },
    body: JSON.stringify({ orderId }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    console.error("[create-checkout] Failed sending confirmation email", { orderId, status: response.status, responseText });
    return false;
  }

  return true;
}

serve(serveCors(async (req) => {
  if (req.method !== "POST") {
    return errorResponse("INVALID_REQUEST", "Method not allowed.", 405);
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return errorResponse("CONFIG_MISSING", "Server configuration is incomplete.", 500);
  }

  let checkoutRef: string | null = null;
  const supabaseAdmin: SupabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const rateLimitResponse = await enforceRateLimit({
      req,
      supabaseAdmin,
      rateLimitSecret,
      route: "create-checkout",
      limit: 6,
      windowSeconds: 600,
      auditEventType: "checkout.rate_limited",
    });
    if (rateLimitResponse) return rateLimitResponse;

    const siteOrigin = getConfiguredSiteOrigin();
    if (!siteOrigin.ok) return siteOrigin.response;

    const parsedPayload = await readJsonBody<unknown>(req, 24 * 1024);
    if ("response" in parsedPayload) return parsedPayload.response;

    const payload = parsedPayload.data;
    const validation = validateRequest(payload, siteOrigin.origin);
    if (!validation.ok) return validation.response;

    const input = validation.value;
    const settings = await loadCheckoutSettings(supabaseAdmin);
    if (settings.maintenanceMode.enabled) {
      return errorResponse(
        "CHECKOUT_DISABLED",
        settings.maintenanceMode.message ?? "Checkout is temporarily unavailable. Please try again shortly.",
        503
      );
    }

    const hasPhysicalItems = input.items.some((item) => !item.isDigital);
    const shippingNok = computeShippingNok(input.deliveryMethod, hasPhysicalItems, settings.shippingCost);

    const computedItems = input.items.map((item) => {
      const unitPriceNok = item.isDigital ? settings.stlFilePrice : settings.products[item.blockVariant];
      const displayName =
        item.isDigital
          ? `Digital 3D-print-fil – Stepper ${BLOCK_VARIANT_LABELS[item.blockVariant]}`
          : `Ferdig printet – Stepper ${BLOCK_VARIANT_LABELS[item.blockVariant]}`;

      return {
        item,
        displayName,
        unitPriceNok,
      };
    });

    const subtotalNok = computedItems.reduce((sum, { unitPriceNok, item }) => sum + unitPriceNok * item.quantity, 0);
    const preDiscountTotalNok = subtotalNok + shippingNok;

    const discountResult = computeDiscountNok(input.promoCode, settings.promoCodes, preDiscountTotalNok);
    if (!discountResult.ok) {
      return errorResponse("INVALID_PROMO", discountResult.error, 400);
    }

    const promoCode = discountResult.promoCode;
    const promoDiscountNok = discountResult.discountNok;
    const totalNok = Math.max(0, preDiscountTotalNok - promoDiscountNok);

    checkoutRef = crypto.randomUUID();

    const subtotalAmountOre = toOre(subtotalNok);
    const shippingAmountOre = toOre(shippingNok);
    const promoDiscountOre = toOre(promoDiscountNok);
    const totalAmountOre = toOre(totalNok);

    const orderLineItems = computedItems.map(({ displayName, unitPriceNok, item }) => ({
      name: displayName,
      quantity: item.quantity,
      price: toOre(unitPriceNok),
      productId: item.productId,
    }));

    const configSnapshot = {
      version: 1,
      items: computedItems.map(({ item, unitPriceNok }) => extractConfigSnapshot(item, toOre(unitPriceNok))),
      promoCode,
      promoDiscount: promoDiscountOre,
    };

    const pickupLocation =
      input.deliveryMethod in PICKUP_LOCATION_LABELS ? PICKUP_LOCATION_LABELS[input.deliveryMethod] : null;

    // If total is 0 after discount, create order server-side (no Stripe) and send confirmation email.
    if (totalNok === 0) {
      const freeSessionId = `free_order_${checkoutRef}`;
      const orderId = crypto.randomUUID();

      const { error: insertCheckoutError } = await supabaseAdmin.from("checkout_sessions").insert({
        id: checkoutRef,
        stripe_checkout_session_id: freeSessionId,
        status: "paid",
        customer_name: input.customerName,
        customer_email: input.customerEmail,
        customer_phone: input.customerPhone,
        delivery_method: input.deliveryMethod,
        pickup_location: pickupLocation,
        shipping_address: input.shippingAddress,
        promo_code: promoCode,
        promo_discount_amount: promoDiscountOre,
        subtotal_amount: subtotalAmountOre,
        shipping_amount: shippingAmountOre,
        total_amount: totalAmountOre,
        currency: "NOK",
        line_items: orderLineItems,
        config_snapshot: configSnapshot,
        error_message: null,
      });

      if (insertCheckoutError) {
        console.error("[create-checkout] Failed storing free checkout snapshot", insertCheckoutError);
        return errorResponse("SESSION_PERSIST_FAILED", "Could not persist checkout session.", 500);
      }

      const { error: insertOrderError } = await supabaseAdmin.from("orders").insert({
        id: orderId,
        customer_name: input.customerName,
        customer_email: input.customerEmail,
        customer_phone: input.customerPhone,
        delivery_method: input.deliveryMethod,
        pickup_location: pickupLocation,
        shipping_address: input.shippingAddress,
        line_items: orderLineItems,
        config_snapshot: configSnapshot,
        subtotal_amount: subtotalAmountOre,
        shipping_amount: shippingAmountOre,
        total_amount: totalAmountOre,
        currency: "NOK",
        status: "new",
        stripe_checkout_session_id: freeSessionId,
      });

      if (insertOrderError) {
        console.error("[create-checkout] Failed creating free order", { orderId, insertOrderError });
        await supabaseAdmin
          .from("checkout_sessions")
          .update({ status: "failed", error_message: "Failed creating order." })
          .eq("id", checkoutRef);
        return errorResponse("INTERNAL_ERROR", "Could not create order.", 500);
      }

      const { error: linkOrderError } = await supabaseAdmin
        .from("checkout_sessions")
        .update({ order_id: orderId, error_message: null })
        .eq("id", checkoutRef);

      if (linkOrderError) {
        console.error("[create-checkout] Failed linking free checkout session to order", {
          checkoutRef,
          orderId,
          linkOrderError,
        });
      }

      const emailOk = await sendOrderConfirmationEmail(supabaseUrl, supabaseServiceRoleKey, orderId);
      if (emailOk) {
        await supabaseAdmin
          .from("checkout_sessions")
          .update({ confirmation_email_sent_at: new Date().toISOString() })
          .eq("id", checkoutRef);
      }

      return jsonResponse({
        success: true,
        freeOrder: true,
        orderId,
        totals: {
          subtotal: subtotalNok,
          shipping: shippingNok,
          promoDiscount: promoDiscountNok,
          total: totalNok,
        },
      });
    }

    // Paid order: requires Stripe secret.
    if (!stripeSecretKey) {
      return errorResponse("CONFIG_MISSING", "Server configuration is incomplete.", 500);
    }

    const { error: insertError } = await supabaseAdmin.from("checkout_sessions").insert({
      id: checkoutRef,
      status: "pending",
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone,
      delivery_method: input.deliveryMethod,
      pickup_location: pickupLocation,
      shipping_address: input.shippingAddress,
      promo_code: promoCode,
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

    const stripe = new Stripe(stripeSecretKey, { apiVersion: buildStripeApiVersion(input.paymentMethod) });

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = computedItems.map(({ displayName, unitPriceNok, item }) => ({
      price_data: {
        currency: "nok",
        product_data: { name: displayName },
        unit_amount: toOre(unitPriceNok),
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
        name: promoCode ?? "Rabatt",
      });
      discountList.push({ coupon: coupon.id });
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

    const checkoutToken = ORDER_STATUS_SECRET
      ? await computeCheckoutToken(ORDER_STATUS_SECRET, session.id)
      : undefined;

    return jsonResponse({
      success: true,
      url: session.url,
      sessionId: session.id,
      checkoutToken,
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
    return errorResponse("INTERNAL_ERROR", "Internal error.", 500);
  }
}));
