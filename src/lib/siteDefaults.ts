import type { SiteSettings } from "@/types/admin";

export const DEFAULT_PRODUCTS: SiteSettings["products"] = [
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
];

export const DEFAULT_STL_FILE_PRICE = 199;
export const DEFAULT_SHIPPING_COST = 79;
export const DEFAULT_MAINTENANCE_MESSAGE =
  "Bestilling er midlertidig satt pa pause. Prov igjen om kort tid.";

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  products: DEFAULT_PRODUCTS,
  stl_file_price: DEFAULT_STL_FILE_PRICE,
  shipping_cost: DEFAULT_SHIPPING_COST,
  promo_codes: {},
  maintenance_mode: {
    enabled: false,
    message: DEFAULT_MAINTENANCE_MESSAGE,
  },
};
