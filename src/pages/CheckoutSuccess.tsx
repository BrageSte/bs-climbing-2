import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, Loader2, Mail, MapPin, Package } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useCart } from "@/contexts/CartContext";
import { supabase } from "@/integrations/supabase/browserClient";
import { DeliveryMethod, Order, PICKUP_LOCATIONS, ShippingAddress, isDigitalOnlyCart } from "@/types/shop";
import { getDeliveryMethodLabel } from "@/types/shop";
import { readSupabaseFunctionError, toFriendlySecurityMessage } from "@/lib/securityMessages";

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 60_000;

interface CheckoutResultResponse {
  success?: boolean;
  status?: "pending" | "paid" | "expired" | "failed";
  order?: Record<string, unknown>;
  checkout?: Record<string, unknown>;
  error?: {
    code?: string;
    message?: string;
  };
}

interface VerifySessionResponse {
  success?: boolean;
  paid?: boolean;
  paymentStatus?: string;
  error?: {
    code?: string;
    message?: string;
  };
}

async function toFriendlyInvokeError(invokeError: unknown, fallback: string) {
  const details = await readSupabaseFunctionError(invokeError);
  return toFriendlySecurityMessage({
    ...details,
    message: details.message || fallback,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDeliveryMethod(value: unknown): DeliveryMethod {
  return value === "shipping" || value === "pickup-gneis" || value === "pickup-oslo"
    ? value
    : null;
}

function parseShippingAddress(value: unknown): ShippingAddress | undefined {
  if (!isRecord(value)) return undefined;
  const line1 = typeof value.line1 === "string" ? value.line1 : null;
  const line2 = typeof value.line2 === "string" ? value.line2 : undefined;
  const postalCode =
    typeof value.postalCode === "string"
      ? value.postalCode
      : typeof value.postal_code === "string"
        ? value.postal_code
        : null;
  const city = typeof value.city === "string" ? value.city : null;

  if (!line1 || !postalCode || !city) return undefined;
  return { line1, line2, postalCode, city };
}

function parseLineItems(value: unknown): Array<{
  name: string;
  quantity: number;
  priceOre: number;
  productId: string;
}> {
  if (!Array.isArray(value)) return [];
  return value
    .map((lineItem, index) => {
      if (!isRecord(lineItem)) return null;
      const name = typeof lineItem.name === "string" ? lineItem.name : null;
      const quantity = typeof lineItem.quantity === "number" ? lineItem.quantity : null;
      const priceOre = typeof lineItem.price === "number" ? lineItem.price : null;
      const productId =
        typeof lineItem.productId === "string" && lineItem.productId.trim()
          ? lineItem.productId
          : `stripe-item-${index}`;

      if (!name || !quantity || quantity <= 0 || !priceOre || priceOre <= 0) return null;
      return { name, quantity, priceOre, productId };
    })
    .filter(
      (
        lineItem
      ): lineItem is {
        name: string;
        quantity: number;
        priceOre: number;
        productId: string;
      } => lineItem !== null
    );
}

function parseConfigItems(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  return value.items.filter(isRecord);
}

function mapOrderRowToOrder(orderRow: Record<string, unknown>): Order | null {
  const orderId = typeof orderRow.id === "string" ? orderRow.id : null;
  const createdAt = typeof orderRow.created_at === "string" ? orderRow.created_at : new Date().toISOString();
  const customerName = typeof orderRow.customer_name === "string" ? orderRow.customer_name : undefined;
  const customerEmail = typeof orderRow.customer_email === "string" ? orderRow.customer_email : undefined;
  const customerPhone = typeof orderRow.customer_phone === "string" ? orderRow.customer_phone : undefined;
  const deliveryMethod = parseDeliveryMethod(orderRow.delivery_method);
  const shippingAddress = parseShippingAddress(orderRow.shipping_address);

  if (!orderId) return null;

  const lineItems = parseLineItems(orderRow.line_items);
  if (lineItems.length === 0) return null;

  const configSnapshot = orderRow.config_snapshot;
  const configItems = parseConfigItems(configSnapshot);
  const configByProductId = new Map<string, Record<string, unknown>>();
  configItems.forEach((configItem, index) => {
    const productId =
      typeof configItem.productId === "string" && configItem.productId.trim()
        ? configItem.productId
        : lineItems[index]?.productId;
    if (productId) configByProductId.set(productId, configItem);
  });

  const items = lineItems.map((lineItem) => {
    const configItem = configByProductId.get(lineItem.productId);
    const blockVariant =
      configItem?.blockVariant === "shortedge" || configItem?.blockVariant === "longedge"
        ? configItem.blockVariant
        : undefined;
    const widths = isRecord(configItem?.widths) ? configItem.widths : undefined;
    const heights = isRecord(configItem?.heights) ? configItem.heights : undefined;
    const depth = typeof configItem?.depth === "number" ? configItem.depth : undefined;
    const totalWidth = typeof configItem?.totalWidth === "number" ? configItem.totalWidth : undefined;
    const isDigital = configItem?.type === "file";

    return {
      product: {
        id: lineItem.productId,
        name: lineItem.name,
        description: "",
        price: Math.round(lineItem.priceOre / 100),
        isDigital,
        config:
          blockVariant && widths && heights && typeof depth === "number" && typeof totalWidth === "number"
            ? {
                blockVariant: blockVariant as 'shortedge' | 'longedge',
                widths: widths as {
                  lillefinger: number;
                  ringfinger: number;
                  langfinger: number;
                  pekefinger: number;
                },
                heights: heights as {
                  lillefinger: number;
                  ringfinger: number;
                  langfinger: number;
                  pekefinger: number;
                },
                depth,
                totalWidth,
              }
            : undefined,
      },
      quantity: lineItem.quantity,
    };
  });

  const subtotalAmount = typeof orderRow.subtotal_amount === "number" ? orderRow.subtotal_amount : 0;
  const shippingAmount = typeof orderRow.shipping_amount === "number" ? orderRow.shipping_amount : 0;
  const totalAmount = typeof orderRow.total_amount === "number" ? orderRow.total_amount : 0;

  let promoCode: string | undefined;
  let promoDiscount = 0;
  if (isRecord(configSnapshot)) {
    if (typeof configSnapshot.promoCode === "string") {
      promoCode = configSnapshot.promoCode;
    }
    if (typeof configSnapshot.promoDiscount === "number") {
      promoDiscount = Math.round(configSnapshot.promoDiscount / 100);
    }
  }

  return {
    orderId,
    items,
    subtotal: Math.round(subtotalAmount / 100),
    shipping: Math.round(shippingAmount / 100),
    total: Math.round(totalAmount / 100),
    email: customerEmail,
    customerName,
    customerPhone,
    shippingAddress,
    promoCode,
    promoDiscount,
    deliveryMethod,
    createdAt,
    status: "paid",
    savedToDatabase: true,
  };
}

export default function CheckoutSuccess() {
  const { clearCart } = useCart();
  const [searchParams] = useSearchParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Verifiserer betaling...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    const sessionId = searchParams.get("session_id");

    const processOrder = async () => {
      try {
        if (sessionId === "free_order") {
          const stored = sessionStorage.getItem("bs-climbing-pending-order");
          if (stored) {
            const pendingOrder = JSON.parse(stored) as Order;
            sessionStorage.removeItem("bs-climbing-pending-order");
            if (isActive) {
              setOrder(pendingOrder);
              setLoading(false);
            }
            clearCart();
            return;
          }

          if (isActive) {
            setError("Bestillingen ble fullfort, men vi fant ikke ordredata lokalt.");
            setLoading(false);
          }
          return;
        }

        if (!sessionId) {
          if (isActive) {
            setError("Mangler session_id i URL.");
            setLoading(false);
          }
          return;
        }

        const sb = supabase;
        if (!sb) {
          if (isActive) {
            setError(
              "Betalingen ble fullfort, men vi kan ikke verifisere ordren fordi Supabase ikke er konfigurert. Oppdater baked config i src/integrations/supabase/publicEnv.ts eller sett VITE_SUPABASE_URL + (VITE_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_ANON_KEY) der hosten stotter det."
            );
            setLoading(false);
          }
          return;
        }

        const checkoutToken = sessionStorage.getItem(`bs-checkout-token-${sessionId}`) ?? "";

        const start = Date.now();
        while (isActive && Date.now() - start < POLL_TIMEOUT_MS) {
          const { data, error: resultError } = await sb.functions.invoke<CheckoutResultResponse>(
            "get-checkout-result",
            { body: { sessionId }, headers: { "x-checkout-token": checkoutToken } }
          );

          if (resultError) {
            throw new Error(await toFriendlyInvokeError(resultError, "Kunne ikke hente checkout-resultat."));
          }

          if (data?.success && data.status === "paid" && data.order) {
            const mappedOrder = mapOrderRowToOrder(data.order);
            if (!mappedOrder) {
              throw new Error("Ordredata hadde ugyldig format.");
            }

            if (isActive) {
              setOrder(mappedOrder);
              setLoading(false);
            }
            clearCart();
            return;
          }

          if (data?.success && data.status === "expired") {
            if (isActive) {
              setError("Betalingssesjonen utlop for betalingen ble fullfort.");
              setLoading(false);
            }
            return;
          }

          if (data?.success && data.status === "failed") {
            if (isActive) {
              setError("Betalingen kunne ikke fullfores.");
              setLoading(false);
            }
            return;
          }

          if (isActive) {
            setLoadingMessage("Betaling mottatt. Venter pa ordrebekreftelse...");
          }
          await sleep(POLL_INTERVAL_MS);
        }

        const { data: verifyData } = await sb.functions.invoke<VerifySessionResponse>("verify-session", {
          body: { sessionId },
          headers: { "x-checkout-token": checkoutToken },
        });

        if (verifyData?.success && verifyData.paid) {
          if (isActive) {
            setError(
              "Betalingen er registrert, men ordren behandles fortsatt. Oppdater siden om et minutt eller kontakt post@bsclimbing.no."
            );
            setLoading(false);
          }
          return;
        }

        if (verifyData?.success === false && verifyData.error) {
          const message = toFriendlySecurityMessage({
            code: verifyData.error.code,
            message: verifyData.error.message ?? "Kunne ikke verifisere betalingen.",
          });
          if (isActive) {
            setError(message);
            setLoading(false);
          }
          return;
        }

        if (isActive) {
          setError("Kunne ikke verifisere betalingen innen tidsvinduet.");
          setLoading(false);
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error("[checkout-success] error", err);
        if (isActive) {
          setError("Noe gikk galt ved verifisering av betalingen. Kontakt oss hvis du ble belastet.");
          setLoading(false);
        }
      }
    };

    void processOrder();
    return () => {
      isActive = false;
    };
  }, [clearCart, searchParams]);

  const isDigitalOnly = useMemo(() => {
    if (!order) return false;
    return isDigitalOnlyCart(order.items);
  }, [order]);

  const pickupLocation = useMemo(() => {
    if (!order?.deliveryMethod) return null;
    return PICKUP_LOCATIONS.find((location) => location.id === order.deliveryMethod) || null;
  }, [order]);

  if (loading) {
    return (
      <>
        <Header />
        <main className="min-h-screen bg-background pt-20">
          <div className="mx-auto max-w-2xl px-4 py-16 text-center">
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primary" />
            <p className="text-muted-foreground">{loadingMessage}</p>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  if (error) {
    return (
      <>
        <Header />
        <main className="min-h-screen bg-background pt-20">
          <div className="mx-auto max-w-2xl px-4 py-16 text-center">
            <h1 className="mb-4 text-2xl font-bold">Betalingsfeil</h1>
            <p className="mb-8 text-muted-foreground">{error}</p>
            <a href="mailto:post@bsclimbing.no" className="text-primary hover:underline">
              Kontakt oss: post@bsclimbing.no
            </a>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background pt-20">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-valid/20">
            <CheckCircle2 className="h-10 w-10 text-valid" />
          </div>

          <h1 className="mb-4 text-3xl font-bold">Takk for bestillingen!</h1>
          <p className="mx-auto mb-8 max-w-md text-muted-foreground">
            {isDigitalOnly
              ? "STL-filen sendes til e-postadressen din innen fa minutter."
              : "Vi har mottatt din bestilling og sender deg en bekreftelse pa e-post."}
          </p>

          {order && (
            <div className="mb-8 rounded-2xl border border-border bg-card p-6 text-left">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Ordredetaljer</h2>
                <span className="text-sm font-mono text-muted-foreground">#{order.orderId.slice(0, 8)}</span>
              </div>

              <div className="mb-6 space-y-3">
                {order.items.map((item) => (
                  <div key={item.product.id} className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-light">
                      <span className="text-xl">{item.product.isDigital ? "📄" : "🧗"}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{item.product.name}</div>
                      {item.product.config && (
                        <div className="text-xs text-muted-foreground">
                          {item.product.config.totalWidth.toFixed(1)}mm × {item.product.config.depth}mm
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-foreground">
                        {item.product.price * item.quantity},- kr
                      </div>
                      <div className="text-xs text-muted-foreground">x{item.quantity}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{order.subtotal},- kr</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {order.deliveryMethod ? getDeliveryMethodLabel(order.deliveryMethod) : "Levering"}
                  </span>
                  <span className={order.shipping === 0 ? "text-valid" : ""}>
                    {order.shipping > 0 ? `${order.shipping},- kr` : "Gratis"}
                  </span>
                </div>
                <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                  <span>Totalt</span>
                  <span className="text-primary">{order.total},- kr</span>
                </div>
              </div>

              {order.email && (
                <p className="mt-4 text-sm text-muted-foreground">
                  Bekreftelse sendt til: <span className="text-foreground">{order.email}</span>
                </p>
              )}
            </div>
          )}

          {isDigitalOnly ? (
            <div className="mb-8 rounded-2xl border border-border bg-card p-6">
              <div className="flex items-start gap-4 text-left">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Mail className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="mb-2 font-semibold">Digital levering</h3>
                  <p className="text-sm text-muted-foreground">
                    STL-filen sendes til e-postadressen din. Sjekk innboksen (og spam-mappen) i lopet av de neste
                    minuttene.
                  </p>
                </div>
              </div>
            </div>
          ) : pickupLocation ? (
            <div className="mb-8 rounded-2xl border border-border bg-card p-6">
              <div className="flex items-start gap-4 text-left">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-valid/10">
                  <MapPin className="h-5 w-5 text-valid" />
                </div>
                <div>
                  <h3 className="mb-2 font-semibold">Hent din bestilling</h3>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Vi gir deg beskjed pa e-post nar bestillingen er klar for henting.
                  </p>
                  <div className="rounded-lg bg-surface-light p-3">
                    <div className="text-sm font-medium text-foreground">{pickupLocation.name}</div>
                    <div className="text-xs text-muted-foreground">{pickupLocation.address}</div>
                    {pickupLocation.description && (
                      <div className="mt-1 text-xs text-muted-foreground">{pickupLocation.description}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-8 rounded-2xl border border-border bg-card p-6">
              <div className="flex items-start gap-4 text-left">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Package className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="mb-2 font-semibold">Hva skjer na?</h3>
                  <ol className="space-y-2 text-sm text-muted-foreground">
                    <li>1. Vi starter produksjonen av din tilpassede Stepper</li>
                    <li>2. Du far sporingsinfo pa e-post nar vi sender</li>
                    <li>3. Forventet leveringstid: 3-5 virkedager</li>
                  </ol>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <Link to="/configure" className="btn-primary">
              Lag en til
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/" className="btn-secondary">
              Tilbake til forsiden
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
