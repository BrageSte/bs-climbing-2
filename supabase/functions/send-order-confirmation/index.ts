import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { serveCors } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/timing.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORDER_STATUS_SECRET = Deno.env.get("ORDER_STATUS_SECRET");

const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })
  : null;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function toBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function computeOrderStatusToken(secret: string, orderId: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(orderId));
  return toBase64Url(new Uint8Array(signature));
}

function isInternalAuthorized(req: Request): boolean {
  if (!SUPABASE_SERVICE_ROLE_KEY) return false;
  const bearer = extractBearerToken(req.headers.get("authorization"));
  const apikey = req.headers.get("apikey")?.trim() ?? null;
  const bearerMatch = bearer !== null && timingSafeEqual(bearer, SUPABASE_SERVICE_ROLE_KEY);
  const apikeyMatch = apikey !== null && timingSafeEqual(apikey, SUPABASE_SERVICE_ROLE_KEY);
  return bearerMatch || apikeyMatch;
}

async function resolveProductionNumber(order: OrderConfirmationRequest): Promise<OrderConfirmationRequest> {
  if (order.productionNumber !== undefined && order.productionNumber !== null) return order;
  if (!supabaseAdmin) return order;

  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('production_number')
    .eq('id', order.orderId)
    .single();

  if (!error && data?.production_number) {
    return { ...order, productionNumber: data.production_number };
  }

  return order;
}

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface ShippingAddress {
  line1: string;
  line2?: string;
  postalCode: string;
  city: string;
}

interface HeightConfig {
  lillefinger?: number;
  ringfinger?: number;
  langfinger?: number;
  pekefinger?: number;
}

interface ConfigSnapshot {
  heights?: HeightConfig;
}

interface OrderConfirmationRequest {
  orderId: string;
  productionNumber?: number;
  orderStatusToken?: string;
  customerEmail: string;
  customerName: string;
  siteUrl?: string;
  items: OrderItem[];
  deliveryMethod: string;
  pickupLocation?: string;
  shippingAddress?: ShippingAddress;
  subtotal: number;
  shipping: number;
  promoDiscount?: number;
  total: number;
  configSnapshot?: ConfigSnapshot;
}

function formatPrice(amount: number): string {
  return `${amount.toLocaleString("nb-NO")},-`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeSiteUrl(value?: string): string {
  const trimmedValue = value?.trim();
  if (!trimmedValue) return "";

  const withProtocol = /^https?:\/\//i.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`;

  try {
    return new URL(withProtocol).toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function formatProductionNumber(value?: number | null, width = 4): string {
  if (value === null || value === undefined) return "";
  return value.toString().padStart(width, "0");
}

function validateHeightDifferences(configSnapshot?: ConfigSnapshot): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (configSnapshot?.heights) {
    const heights = configSnapshot.heights;

    // Calculate height differences from the actual heights
    const lille = heights.lillefinger || 10;
    const ring = heights.ringfinger || 10;
    const lang = heights.langfinger || 10;
    const peke = heights.pekefinger || 10;

    const lilleToRing = ring - lille;
    const ringToLang = lang - ring;
    const langToPeke = peke - lang;

    const heightDiffs = [
      { name: 'Lille → Ring', value: lilleToRing },
      { name: 'Ring → Lang', value: ringToLang },
      { name: 'Lang → Peke', value: langToPeke }
    ];

    heightDiffs.forEach(diff => {
      const absValue = Math.abs(diff.value);
      if (absValue > 30) {
        warnings.push(`Warning: ${diff.name} height difference is ${diff.value > 0 ? '+' : ''}${diff.value}mm (unusually high, typical range is -30mm to +30mm)`);
      }
      if (absValue > 50) {
        warnings.push(`Error: ${diff.name} height difference is ${diff.value > 0 ? '+' : ''}${diff.value}mm (outside acceptable range of -50mm to +50mm)`);
      }
    });
  }

  return {
    valid: warnings.filter(w => w.includes('Error')).length === 0,
    warnings
  };
}

function generateEmailHtml(order: OrderConfirmationRequest): string {
  const productionNumber = formatProductionNumber(order.productionNumber);
  const baseUrl = normalizeSiteUrl(order.siteUrl || Deno.env.get("PUBLIC_SITE_URL"));
  const tokenParam = order.orderStatusToken ? `&token=${encodeURIComponent(order.orderStatusToken)}` : "";
  const statusUrl = baseUrl
    ? `${baseUrl}/order-status?orderId=${encodeURIComponent(order.orderId)}${tokenParam}`
    : "";
  const safeStatusUrl = statusUrl ? escapeHtml(statusUrl) : "";

  const itemsHtml = order.items
    .map(
      (item) => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #333;">${escapeHtml(item.name)}</td>
          <td style="padding: 12px; border-bottom: 1px solid #333; text-align: center;">${item.quantity}</td>
          <td style="padding: 12px; border-bottom: 1px solid #333; text-align: right;">${formatPrice(item.price * item.quantity)}</td>
        </tr>
      `
    )
    .join("");

  let deliveryHtml = "";
  if (order.deliveryMethod === "shipping" && order.shippingAddress) {
    deliveryHtml = `
      <p style="margin: 0 0 8px 0;"><strong>Leveringsmetode:</strong> Hjemlevering</p>
      <p style="margin: 0 0 4px 0;">${escapeHtml(order.shippingAddress.line1)}</p>
      ${
        order.shippingAddress.line2
          ? `<p style="margin: 0 0 4px 0;">${escapeHtml(order.shippingAddress.line2)}</p>`
          : ""
      }
      <p style="margin: 0;">${escapeHtml(order.shippingAddress.postalCode)} ${escapeHtml(order.shippingAddress.city)}</p>
    `;
  } else if (order.pickupLocation) {
    deliveryHtml = `
      <p style="margin: 0 0 8px 0;"><strong>Leveringsmetode:</strong> Henting</p>
      <p style="margin: 0;">${escapeHtml(order.pickupLocation)}</p>
    `;
  } else {
    deliveryHtml = `<p style="margin: 0;"><strong>Leveringsmetode:</strong> Digital levering</p>`;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ordrebekreftelse - BS Climbing</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f0f0f; color: #ffffff;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 40px;">
      <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff;">BS Climbing</h1>
      <p style="margin: 8px 0 0 0; color: #888888; font-size: 14px;">Skreddersydde klatregrep</p>
    </div>

    <!-- Main content -->
    <div style="background-color: #1a1a1a; border-radius: 16px; padding: 32px; border: 1px solid #333;">
      <h2 style="margin: 0 0 8px 0; font-size: 24px; color: #ffffff;">Takk for bestillingen!</h2>
      <p style="margin: 0 0 24px 0; color: #888888;">
        Hei ${escapeHtml(order.customerName)}, vi har mottatt din bestilling og setter i gang med produksjonen snart.
      </p>

      <!-- Order ID -->
      <div style="background-color: #262626; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="margin: 0; font-size: 14px; color: #888888;">Ordrenummer</p>
        <p style="margin: 4px 0 0 0; font-size: 18px; font-weight: 600; color: #ff6b35; font-family: monospace;">${escapeHtml(order.orderId)}</p>
        ${productionNumber ? `
        <p style="margin: 12px 0 0 0; font-size: 14px; color: #888888;">Produksjonsnummer</p>
        <p style="margin: 4px 0 0 0; font-size: 18px; font-weight: 600; color: #ff6b35; font-family: monospace;">${escapeHtml(productionNumber)}</p>
        ` : ''}
        ${order.orderStatusToken ? `
        <p style="margin: 12px 0 0 0; font-size: 14px; color: #888888;">Sikkerhetskode</p>
        <p style="margin: 4px 0 0 0; font-size: 14px; font-weight: 600; color: #ff6b35; font-family: monospace; word-break: break-all;">${escapeHtml(order.orderStatusToken)}</p>
        ` : ''}
      </div>
      ${safeStatusUrl ? `
      <div style="margin-bottom: 24px;">
        <a href="${safeStatusUrl}" style="display: inline-block; padding: 12px 18px; background-color: #ff6b35; color: #0f0f0f; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
          Sjekk ordrestatus
        </a>
        <p style="margin: 8px 0 0 0; font-size: 12px; color: #888888;">
          Følg produksjon og printkø direkte via lenken.
        </p>
        <p style="margin: 6px 0 0 0; font-size: 12px;">
          <a href="${safeStatusUrl}" style="color: #ff6b35; word-break: break-all;">
            ${safeStatusUrl}
          </a>
        </p>
      </div>
      ` : ''}

      <!-- Items table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <thead>
          <tr>
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #333; color: #888888; font-weight: 500; font-size: 14px;">Produkt</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #333; color: #888888; font-weight: 500; font-size: 14px;">Antall</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #333; color: #888888; font-weight: 500; font-size: 14px;">Pris</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <!-- Totals -->
      <div style="border-top: 1px solid #333; padding-top: 16px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="color: #888888;">Delsum</span>
          <span style="color: #ffffff;">${formatPrice(order.subtotal)}</span>
        </div>
        ${order.shipping > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="color: #888888;">Frakt</span>
          <span style="color: #ffffff;">${formatPrice(order.shipping)}</span>
        </div>
        ` : ""}
        ${order.promoDiscount && order.promoDiscount > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="color: #22c55e;">Rabatt</span>
          <span style="color: #22c55e;">-${formatPrice(order.promoDiscount)}</span>
        </div>
        ` : ""}
        <div style="display: flex; justify-content: space-between; margin-top: 16px; padding-top: 16px; border-top: 1px solid #333;">
          <span style="font-weight: 600; font-size: 18px; color: #ffffff;">Totalt</span>
          <span style="font-weight: 600; font-size: 18px; color: #ff6b35;">${formatPrice(order.total)}</span>
        </div>
      </div>
    </div>

    <!-- Delivery info -->
    <div style="background-color: #1a1a1a; border-radius: 16px; padding: 24px; margin-top: 24px; border: 1px solid #333;">
      <h3 style="margin: 0 0 16px 0; font-size: 16px; color: #ffffff;">Leveringsinformasjon</h3>
      <div style="color: #cccccc; font-size: 14px;">
        ${deliveryHtml}
      </div>
    </div>

    <!-- What's next -->
    <div style="background-color: #1a1a1a; border-radius: 16px; padding: 24px; margin-top: 24px; border: 1px solid #333;">
      <h3 style="margin: 0 0 16px 0; font-size: 16px; color: #ffffff;">Hva skjer nå?</h3>
      <ol style="margin: 0; padding-left: 20px; color: #cccccc; font-size: 14px; line-height: 1.8;">
        <li>Vi gjennomgår bestillingen din</li>
        <li>Grepet produseres spesialtilpasset dine mål</li>
        <li>Du mottar en e-post når ordren sendes/er klar til henting</li>
      </ol>
    </div>

    <!-- Returns -->
    <div style="background-color: #1a1a1a; border-radius: 16px; padding: 24px; margin-top: 24px; border: 1px solid #333;">
      <h3 style="margin: 0 0 16px 0; font-size: 16px; color: #ffffff;">Angrerett og retur</h3>
      <ul style="margin: 0; padding-left: 20px; color: #cccccc; font-size: 14px; line-height: 1.8;">
        <li>Stepper (ferdig printet) produseres på bestilling og omfattes ikke av angrerett.</li>
        <li>Digitale filer leveres umiddelbart. Når du samtykker til umiddelbar levering bortfaller angreretten.</li>
        <li>Ved feil eller mangel ordner vi opp – send oss ordrenummer og bilder.</li>
      </ul>
      <p style="margin: 12px 0 0 0; color: #cccccc; font-size: 14px;">
        Returadresse: Åstadlia 18, 1396 Billingstad, Norway. Retur avtales alltid på forhånd.
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 40px; color: #666666; font-size: 12px;">
      <p style="margin: 0 0 8px 0;">Har du spørsmål? Kontakt oss på post@bsclimbing.no</p>
      <p style="margin: 0;">© ${new Date().getFullYear()} BS Climbing. Alle rettigheter reservert.</p>
    </div>
  </div>
</body>
</html>
  `;
}

function generateEmailText(order: OrderConfirmationRequest): string {
  const productionNumber = formatProductionNumber(order.productionNumber);
  const baseUrl = normalizeSiteUrl(order.siteUrl || Deno.env.get("PUBLIC_SITE_URL"));
  const tokenParam = order.orderStatusToken ? `&token=${encodeURIComponent(order.orderStatusToken)}` : "";
  const statusUrl = baseUrl
    ? `${baseUrl}/order-status?orderId=${encodeURIComponent(order.orderId)}${tokenParam}`
    : "";

  const deliveryText = order.deliveryMethod === "shipping" && order.shippingAddress
    ? [
        "Leveringsmetode: Hjemlevering",
        order.shippingAddress.line1,
        order.shippingAddress.line2,
        `${order.shippingAddress.postalCode} ${order.shippingAddress.city}`,
      ].filter(Boolean).join("\n")
    : order.pickupLocation
      ? `Leveringsmetode: Henting\n${order.pickupLocation}`
      : "Leveringsmetode: Digital levering";

  const itemsText = order.items
    .map((item) => `- ${item.name} x${item.quantity}: ${formatPrice(item.price * item.quantity)}`)
    .join("\n");

  const lines = [
    `Hei ${order.customerName},`,
    "",
    "Takk for bestillingen hos BS Climbing.",
    `Ordrenummer: ${order.orderId}`,
    productionNumber ? `Produksjonsnummer: ${productionNumber}` : "",
    order.orderStatusToken ? `Sikkerhetskode: ${order.orderStatusToken}` : "",
    statusUrl ? `Sjekk ordrestatus: ${statusUrl}` : "",
    "",
    "Bestilte varer:",
    itemsText,
    "",
    `Delsum: ${formatPrice(order.subtotal)}`,
    `Frakt: ${order.shipping > 0 ? formatPrice(order.shipping) : "Gratis"}`,
    order.promoDiscount && order.promoDiscount > 0 ? `Rabatt: -${formatPrice(order.promoDiscount)}` : "",
    `Totalt: ${formatPrice(order.total)}`,
    "",
    deliveryText,
    "",
    "Har du spørsmål? Kontakt oss på post@bsclimbing.no",
  ].filter(Boolean);

  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseLineItemsOreToNok(value: unknown): OrderItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((lineItem) => {
      if (!isRecord(lineItem)) return null;
      const name = typeof lineItem.name === "string" ? lineItem.name.trim() : "";
      const quantity = typeof lineItem.quantity === "number" ? lineItem.quantity : null;
      const priceOre = typeof lineItem.price === "number" ? lineItem.price : null;
      if (!name || !quantity || quantity <= 0 || priceOre === null || priceOre < 0) return null;
      return { name, quantity, price: Math.round(priceOre / 100) };
    })
    .filter((item): item is OrderItem => item !== null);
}

function parseShippingAddress(value: unknown): ShippingAddress | undefined {
  if (!isRecord(value)) return undefined;
  const line1 = typeof value.line1 === "string" ? value.line1 : "";
  const line2 = typeof value.line2 === "string" ? value.line2 : undefined;
  const postalCode = typeof value.postalCode === "string" ? value.postalCode : "";
  const city = typeof value.city === "string" ? value.city : "";
  if (!line1 || !postalCode || !city) return undefined;
  return { line1, line2, postalCode, city };
}

function extractPromoDiscountNok(configSnapshot: unknown): number {
  if (!isRecord(configSnapshot)) return 0;
  const promoDiscountOre = configSnapshot.promoDiscount;
  if (typeof promoDiscountOre !== "number" || !Number.isFinite(promoDiscountOre) || promoDiscountOre <= 0) return 0;
  return Math.round(promoDiscountOre / 100);
}

function extractHeightsFromConfigSnapshot(configSnapshot: unknown): HeightConfig | undefined {
  if (!isRecord(configSnapshot)) return undefined;
  const items = Array.isArray(configSnapshot.items) ? configSnapshot.items : null;
  if (!items?.length || !isRecord(items[0])) return undefined;
  const heights = (items[0] as Record<string, unknown>).heights;
  if (!isRecord(heights)) return undefined;
  const lille = typeof heights.lillefinger === "number" ? heights.lillefinger : undefined;
  const ring = typeof heights.ringfinger === "number" ? heights.ringfinger : undefined;
  const lang = typeof heights.langfinger === "number" ? heights.langfinger : undefined;
  const peke = typeof heights.pekefinger === "number" ? heights.pekefinger : undefined;
  if (lille === undefined && ring === undefined && lang === undefined && peke === undefined) return undefined;
  return { lillefinger: lille, ringfinger: ring, langfinger: lang, pekefinger: peke };
}

interface SendOrderConfirmationInput {
  orderId?: string;
  siteUrl?: string;
}

const handler = async (req: Request): Promise<Response> => {
  try {
    if (!isInternalAuthorized(req)) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    if (!supabaseAdmin || !ORDER_STATUS_SECRET) {
      return jsonResponse({ success: false, error: "Configuration missing" }, 500);
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return jsonResponse({ success: false, error: "Configuration missing" }, 500);
    }

    const resend = new Resend(RESEND_API_KEY);
    const body: SendOrderConfirmationInput = await req.json();
    const orderId = body.orderId?.trim();
    if (!orderId) {
      return jsonResponse({ success: false, error: "orderId is required" }, 400);
    }

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select(
        "id,production_number,customer_email,customer_name,delivery_method,pickup_location,shipping_address,line_items,subtotal_amount,shipping_amount,total_amount,config_snapshot"
      )
      .eq("id", orderId)
      .maybeSingle();

    if (error) {
      console.error("[send-order-confirmation] Failed loading order", { orderId, error });
      return jsonResponse({ success: false, error: "Internal error" }, 500);
    }

    if (!order) {
      return jsonResponse({ success: false, error: "Order not found" }, 404);
    }

    const items = parseLineItemsOreToNok(order.line_items);
    if (items.length === 0) {
      console.warn("[send-order-confirmation] Order has no valid line items; skipping email", { orderId });
      return jsonResponse({ success: true, skipped: true }, 200);
    }

    const orderStatusToken = await computeOrderStatusToken(ORDER_STATUS_SECRET, order.id);
    const heights = extractHeightsFromConfigSnapshot(order.config_snapshot);

    let orderData: OrderConfirmationRequest = {
      orderId: order.id,
      productionNumber: order.production_number ?? undefined,
      orderStatusToken,
      customerEmail: order.customer_email as string,
      customerName: order.customer_name as string,
      siteUrl: typeof body.siteUrl === "string" ? body.siteUrl : undefined,
      items,
      deliveryMethod: order.delivery_method as string,
      pickupLocation: (order.pickup_location as string | null) ?? undefined,
      shippingAddress: parseShippingAddress(order.shipping_address),
      subtotal: Math.round((order.subtotal_amount as number) / 100),
      shipping: Math.round((order.shipping_amount as number) / 100),
      promoDiscount: extractPromoDiscountNok(order.config_snapshot),
      total: Math.round((order.total_amount as number) / 100),
      configSnapshot: heights ? { heights } : undefined,
    };

    orderData = await resolveProductionNumber(orderData);

    // Validate height differences if config snapshot exists
    if (orderData.configSnapshot) {
      const validation = validateHeightDifferences(orderData.configSnapshot);
      if (validation.warnings.length > 0) {
        console.warn('Order validation warnings:', validation.warnings);
        console.warn('Order ID:', orderData.orderId);
        // Log to order notes or send to admin notification if needed
      }
    }

    const emailHtml = generateEmailHtml(orderData);
    const emailText = generateEmailText(orderData);

    // Note: The sender domain must be verified in Resend.
    const emailResponse = await resend.emails.send({
      from: "BS Climbing <post@bsclimbing.no>",
      to: [orderData.customerEmail],
      reply_to: "post@bsclimbing.no",
      subject: `Ordrebekreftelse #${orderData.orderId.slice(0, 8).toUpperCase()}`,
      html: emailHtml,
      text: emailText,
    });

    console.log("Order confirmation email sent successfully:", emailResponse);

    return jsonResponse({ success: true }, 200);
  } catch (error: unknown) {
    console.error("Error sending order confirmation email:", error);
    return jsonResponse({ success: false, error: "Internal error" }, 500);
  }
};

serve(serveCors(handler));
