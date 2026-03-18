import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { serveCors } from "../_shared/cors.ts";
import {
  enforceRateLimit,
  readJsonBody,
  secureErrorResponse,
  secureJsonResponse,
} from "../_shared/security.ts";

type PromoCodeRule = { type: "percent" | "fixed"; value: number };

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

function computeDiscountNok(rule: PromoCodeRule, totalNok: number): number {
  if (!Number.isFinite(totalNok) || totalNok <= 0) return 0;
  if (rule.type === "percent") {
    return Math.round(totalNok * (rule.value / 100));
  }
  return Math.min(rule.value, totalNok);
}

interface ValidatePromoInput {
  promoCode?: string;
  totalNok?: number;
}

serve(serveCors(async (req) => {
  if (req.method !== "POST") {
    return secureErrorResponse("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return secureErrorResponse("CONFIG_MISSING", "Server configuration is incomplete.", 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  const rateLimitResponse = await enforceRateLimit({
    req,
    supabaseAdmin,
    rateLimitSecret,
    route: "validate-promo",
    limit: 20,
    windowSeconds: 600,
    auditEventType: "promo.rate_limited",
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const parsedBody = await readJsonBody<ValidatePromoInput>(req, 2 * 1024);
    if ("response" in parsedBody) return parsedBody.response;

    const body = parsedBody.data;
    const rawCode = typeof body.promoCode === "string" ? body.promoCode : "";
    const promoCode = rawCode.trim().toUpperCase();
    const totalNok = asFiniteNumber(body.totalNok) ?? 0;

    if (!promoCode) {
      return secureJsonResponse({ success: true, valid: false, discountNok: 0, message: "Mangler promokode." }, 200);
    }

    if (!Number.isFinite(totalNok) || totalNok <= 0) {
      return secureJsonResponse(
        { success: true, valid: false, discountNok: 0, message: "Ugyldig totalbeløp." },
        200
      );
    }

    const { data, error } = await supabaseAdmin
      .from("site_settings")
      .select("value")
      .eq("key", "promo_codes")
      .maybeSingle();

    if (error) {
      console.error("[validate-promo] DB error loading promo_codes", { code: error.code, message: error.message });
      return secureErrorResponse("DB_ERROR", "Database error.", 500);
    }

    const promoCodes = sanitizePromoCodes(data?.value);
    const rule = promoCodes[promoCode];
    if (!rule) {
      return secureJsonResponse(
        { success: true, valid: false, discountNok: 0, message: "Ugyldig promokode." },
        200
      );
    }

    const discountNok = computeDiscountNok(rule, totalNok);
    return secureJsonResponse(
      { success: true, valid: discountNok > 0, normalizedCode: promoCode, discountNok },
      200
    );
  } catch (error: unknown) {
    console.error("[validate-promo] Unexpected error", error);
    return secureErrorResponse("INTERNAL_ERROR", "Internal error.", 500);
  }
}));
