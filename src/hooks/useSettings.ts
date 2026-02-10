import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/browserClient";
import {
  MaintenanceModeSetting,
  ProductSetting,
  PromoCodeSetting,
  SiteSettings,
} from "@/types/admin";

const DEFAULT_SETTINGS: SiteSettings = {
  products: [
    {
      variant: "shortedge",
      name: "Compact",
      price: 399,
      description:
        "Ultrakompakt design tilpasset fingrene. Individuelt tilpassede steg for optimal halvkrimpp-trening.",
    },
    {
      variant: "longedge",
      name: "Long Edge",
      price: 499,
      description:
        "Ekstra lang flate pa enden (80mm), sa du kan crimpe som pa en vanlig 20 mm kant. Komfortabel avrunding. Dette er ultimate-varianten: individuelle steg med custom mal til fingrene + en vanlig 20 mm flatkant for trening.",
    },
  ],
  stl_file_price: 199,
  shipping_cost: 79,
  promo_codes: {},
  maintenance_mode: {
    enabled: false,
    message: "Bestilling er midlertidig satt pa pause. Prov igjen om kort tid.",
  },
};

type SettingsRow = {
  key: string;
  value: unknown;
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeProductSetting(value: unknown): ProductSetting | null {
  if (!isRecord(value)) return null;

  const variant = value.variant;
  const name = value.name;
  const description = value.description;
  const price = toFiniteNumber(value.price);

  if (variant !== "shortedge" && variant !== "longedge") return null;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof description !== "string" || !description.trim()) return null;
  if (price === null || price <= 0) return null;

  return {
    variant,
    name: name.trim(),
    description: description.trim(),
    price: Math.round(price),
  };
}

function sanitizeProducts(value: unknown): ProductSetting[] {
  const defaultsByVariant = new Map(
    DEFAULT_SETTINGS.products.map((product) => [product.variant, product])
  );

  if (!Array.isArray(value)) {
    return DEFAULT_SETTINGS.products.map((product) => ({ ...product }));
  }

  for (const candidate of value) {
    const parsed = sanitizeProductSetting(candidate);
    if (!parsed) continue;
    defaultsByVariant.set(parsed.variant, parsed);
  }

  const shortedge = defaultsByVariant.get("shortedge");
  const longedge = defaultsByVariant.get("longedge");

  if (!shortedge || !longedge) {
    return DEFAULT_SETTINGS.products.map((product) => ({ ...product }));
  }

  return [shortedge, longedge];
}

function sanitizePromoCodes(value: unknown): Record<string, PromoCodeSetting> {
  if (!isRecord(value)) {
    return {};
  }

  const sanitized: Record<string, PromoCodeSetting> = {};

  for (const [rawCode, promoValue] of Object.entries(value)) {
    if (!isRecord(promoValue)) continue;
    const code = rawCode.trim().toUpperCase();
    if (!code) continue;

    const promoType = promoValue.type;
    const promoAmount = toFiniteNumber(promoValue.value);

    if ((promoType !== "percent" && promoType !== "fixed") || promoAmount === null) {
      continue;
    }

    if (promoType === "percent") {
      const percent = Math.round(promoAmount);
      if (percent <= 0 || percent > 100) continue;
      sanitized[code] = { type: "percent", value: percent };
      continue;
    }

    const fixedAmount = Math.round(promoAmount);
    if (fixedAmount <= 0) continue;
    sanitized[code] = { type: "fixed", value: fixedAmount };
  }

  return sanitized;
}

function sanitizeMaintenanceMode(value: unknown): MaintenanceModeSetting {
  if (!isRecord(value)) {
    return { ...DEFAULT_SETTINGS.maintenance_mode };
  }

  const enabled = value.enabled === true;
  const message =
    typeof value.message === "string" && value.message.trim()
      ? value.message.trim().slice(0, 240)
      : DEFAULT_SETTINGS.maintenance_mode.message;

  return {
    enabled,
    message,
  };
}

function parseSettings(rows: SettingsRow[]): SiteSettings {
  const settings: SiteSettings = {
    products: DEFAULT_SETTINGS.products.map((product) => ({ ...product })),
    stl_file_price: DEFAULT_SETTINGS.stl_file_price,
    shipping_cost: DEFAULT_SETTINGS.shipping_cost,
    promo_codes: { ...DEFAULT_SETTINGS.promo_codes },
    maintenance_mode: { ...DEFAULT_SETTINGS.maintenance_mode },
  };

  for (const row of rows) {
    switch (row.key) {
      case "products": {
        settings.products = sanitizeProducts(row.value);
        break;
      }
      case "stl_file_price": {
        const value = toFiniteNumber(row.value);
        if (value !== null && value > 0) {
          settings.stl_file_price = Math.round(value);
        }
        break;
      }
      case "shipping_cost": {
        const value = toFiniteNumber(row.value);
        if (value !== null && value >= 0) {
          settings.shipping_cost = Math.round(value);
        }
        break;
      }
      case "promo_codes": {
        settings.promo_codes = sanitizePromoCodes(row.value);
        break;
      }
      case "maintenance_mode": {
        settings.maintenance_mode = sanitizeMaintenanceMode(row.value);
        break;
      }
      default:
        break;
    }
  }

  return settings;
}

export function useSettings() {
  return useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => {
      if (!supabase) {
        // Allows app (incl. configurator) to render in Lovable preview even when env isn't set yet.
        return parseSettings([]);
      }

      const { data, error } = await supabase.from("site_settings").select("*");

      if (error) throw error;
      return parseSettings((data ?? []) as SettingsRow[]);
    },
    staleTime: 60_000,
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      if (!supabase) {
        throw new Error(
          "Supabase er ikke konfigurert. Admin-innstillinger kan ikke lagres i denne hosten."
        );
      }
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key, value: value as never, updated_at: new Date().toISOString() });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
  });
}

export { DEFAULT_SETTINGS };
