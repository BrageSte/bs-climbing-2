import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { serveCors } from "../_shared/cors.ts";

type PromoCodeRule = { type: "percent" | "fixed"; value: number };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(
      { success: false, error: { code: "CONFIG_MISSING", message: "Server configuration is incomplete." } },
      500
    );
  }

  try {
    const body: ValidatePromoInput = await req.json();
    const rawCode = typeof body.promoCode === "string" ? body.promoCode : "";
    const promoCode = rawCode.trim().toUpperCase();
    const totalNok = asFiniteNumber(body.totalNok) ?? 0;

    if (!promoCode) {
      return jsonResponse({ success: true, valid: false, discountNok: 0, message: "Mangler promokode." }, 200);
    }

    if (!Number.isFinite(totalNok) || totalNok <= 0) {
      return jsonResponse(
        { success: true, valid: false, discountNok: 0, message: "Ugyldig totalbeløp." },
        200
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabaseAdmin
      .from("site_settings")
      .select("value")
      .eq("key", "promo_codes")
      .maybeSingle();

    if (error) {
      console.error("[validate-promo] DB error loading promo_codes", { code: error.code, message: error.message });
      return jsonResponse(
        { success: false, error: { code: "DB_ERROR", message: "Database error." } },
        500
      );
    }

    const promoCodes = sanitizePromoCodes(data?.value);
    const rule = promoCodes[promoCode];
    if (!rule) {
      return jsonResponse(
        { success: true, valid: false, discountNok: 0, message: "Ugyldig promokode." },
        200
      );
    }

    const discountNok = computeDiscountNok(rule, totalNok);
    return jsonResponse(
      { success: true, valid: discountNok > 0, normalizedCode: promoCode, discountNok },
      200
    );
  } catch (error: unknown) {
    console.error("[validate-promo] Unexpected error", error);
    return jsonResponse({ success: false, error: { code: "INTERNAL_ERROR", message: "Internal error." } }, 500);
  }
}));

