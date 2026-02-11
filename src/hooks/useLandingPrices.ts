import { useQuery } from "@tanstack/react-query";
import { DEFAULT_PRODUCTS, DEFAULT_STL_FILE_PRICE } from "@/lib/siteDefaults";
import type { ProductSetting } from "@/types/admin";

type SettingsRow = {
  key: string;
  value: unknown;
};

type LandingPrices = {
  stlFilePrice: number;
  printedFromPrice: number;
  products: ProductSetting[];
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
    DEFAULT_PRODUCTS.map((product) => [product.variant, { ...product }])
  );

  if (!Array.isArray(value)) {
    return DEFAULT_PRODUCTS.map((product) => ({ ...product }));
  }

  for (const candidate of value) {
    const parsed = sanitizeProductSetting(candidate);
    if (!parsed) continue;
    defaultsByVariant.set(parsed.variant, parsed);
  }

  const shortedge = defaultsByVariant.get("shortedge");
  const longedge = defaultsByVariant.get("longedge");

  if (!shortedge || !longedge) {
    return DEFAULT_PRODUCTS.map((product) => ({ ...product }));
  }

  return [shortedge, longedge];
}

function getPrintedFromPrice(products: ProductSetting[]): number {
  const prices = products
    .map((product) => (Number.isFinite(product.price) ? product.price : null))
    .filter((price): price is number => price !== null);

  return prices.length > 0 ? Math.min(...prices) : 399;
}

const DEFAULT_LANDING_PRICES: LandingPrices = {
  stlFilePrice: DEFAULT_STL_FILE_PRICE,
  printedFromPrice: getPrintedFromPrice(DEFAULT_PRODUCTS),
  products: DEFAULT_PRODUCTS.map((product) => ({ ...product })),
};

function parseLandingPrices(rows: SettingsRow[]): LandingPrices {
  let stlFilePrice = DEFAULT_STL_FILE_PRICE;
  let products = DEFAULT_PRODUCTS.map((product) => ({ ...product }));

  for (const row of rows) {
    switch (row.key) {
      case "products": {
        products = sanitizeProducts(row.value);
        break;
      }
      case "stl_file_price": {
        const parsed = toFiniteNumber(row.value);
        if (parsed !== null && parsed > 0) {
          stlFilePrice = Math.round(parsed);
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    stlFilePrice,
    printedFromPrice: getPrintedFromPrice(products),
    products,
  };
}

export function useLandingPrices() {
  const query = useQuery({
    queryKey: ["landing-prices"],
    queryFn: async (): Promise<LandingPrices> => {
      const { supabase } = await import("@/integrations/supabase/browserClient");
      if (!supabase) return DEFAULT_LANDING_PRICES;

      const { data, error } = await supabase
        .from("site_settings")
        .select("key, value")
        .in("key", ["products", "stl_file_price"]);

      if (error) return DEFAULT_LANDING_PRICES;

      return parseLandingPrices((data ?? []) as SettingsRow[]);
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: DEFAULT_LANDING_PRICES,
  });

  return {
    ...query,
    data: query.data ?? DEFAULT_LANDING_PRICES,
  };
}
