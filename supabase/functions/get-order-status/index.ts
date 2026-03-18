import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { serveCors } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/timing.ts";
import {
  enforceRateLimit,
  readJsonBody,
  secureErrorResponse,
  secureJsonResponse,
} from "../_shared/security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORDER_STATUS_SECRET = Deno.env.get("ORDER_STATUS_SECRET");

const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;

const ERROR_CODES = {
  missingOrderId: "OS_MISSING_ORDER_ID",
  missingAuth: "OS_MISSING_AUTH",
  unauthorized: "OS_UNAUTHORIZED",
  notFound: "OS_NOT_FOUND",
  dbError: "OS_DB_ERROR",
  configMissing: "OS_CONFIG_MISSING",
  internalError: "OS_INTERNAL_ERROR",
} as const;

interface OrderStatusRequest {
  orderId?: string;
}

function extractOrderStatusToken(req: Request): string | null {
  const token = req.headers.get("x-order-status-token")?.trim();
  return token ? token : null;
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

serve(serveCors(async (req) => {
  try {
    if (req.method !== "POST") {
      return secureErrorResponse("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
    }

    const rateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");
    if (!supabaseAdmin || !ORDER_STATUS_SECRET) {
      return secureErrorResponse(ERROR_CODES.configMissing, "Configuration missing", 500);
    }

    const rateLimitResponse = await enforceRateLimit({
      req,
      supabaseAdmin,
      rateLimitSecret,
      route: "get-order-status",
      limit: 20,
      windowSeconds: 600,
      auditEventType: "status.rate_limited",
    });
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const parsedBody = await readJsonBody<OrderStatusRequest>(req, 2 * 1024);
    if ("response" in parsedBody) return parsedBody.response;

    const body = parsedBody.data;
    const orderId = body.orderId?.trim();
    if (!orderId) {
      return secureJsonResponse(
        { success: false, error: "orderId is required", code: ERROR_CODES.missingOrderId },
        400,
      );
    }

    const token = extractOrderStatusToken(req);
    if (!token) {
      return secureJsonResponse(
        { success: false, error: "Missing order status token", code: ERROR_CODES.missingAuth },
        401
      );
    }

    const expected = await computeOrderStatusToken(ORDER_STATUS_SECRET, orderId);
    if (!timingSafeEqual(token, expected)) {
      return secureJsonResponse(
        { success: false, error: "Unauthorized", code: ERROR_CODES.unauthorized },
        403
      );
    }

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("id,created_at,status,production_number,delivery_method,pickup_location")
      .eq("id", orderId)
      .maybeSingle();

    if (error) {
      console.error("[get-order-status] DB error", { code: error.code, message: error.message });
      const status = error.code === "PGRST116" ? 404 : 500;
      return secureJsonResponse(
        {
          success: false,
          error: status === 404 ? "Order not found" : "Database error",
          code: status === 404 ? ERROR_CODES.notFound : ERROR_CODES.dbError,
        },
        status
      );
    }

    if (!order) {
      return secureJsonResponse({ success: false, error: "Order not found", code: ERROR_CODES.notFound }, 404);
    }

    let queueInfo: {
      position?: number;
      ahead?: number;
      total?: number;
      basis?: "printing" | "ready_to_print" | "in_production";
    } | null = null;

    const queueStatuses = ["printing", "ready_to_print", "in_production"] as const;
    if (queueStatuses.includes(order.status) && order.production_number) {
      const { count: aheadCount } = await supabaseAdmin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", order.status)
        .lt("production_number", order.production_number);

      const { count: totalCount } = await supabaseAdmin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", order.status);

      const ahead = aheadCount ?? 0;
      queueInfo = {
        position: ahead + 1,
        ahead,
        total: totalCount ?? undefined,
        basis: order.status,
      };
    }

    return secureJsonResponse({
      success: true,
      order: {
        id: order.id,
        createdAt: order.created_at,
        status: order.status,
        productionNumber: order.production_number,
        deliveryMethod: order.delivery_method,
        pickupLocation: order.pickup_location,
      },
      queue: queueInfo,
    });
  } catch (error: unknown) {
    console.error("[get-order-status] Unexpected error", error);
    return secureJsonResponse(
      { success: false, error: "Internal error", code: ERROR_CODES.internalError },
      500
    );
  }
}, ["x-order-status-token"]));
