import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CartProvider } from "@/contexts/CartContext";
import { lazy, Suspense, useEffect } from "react";

// Keep Index for immediate load
import Index from "./pages/Index";

// Lazy load other pages
const Configure = lazy(() => import("./pages/Configure"));
const Cart = lazy(() => import("./pages/Cart"));
const Checkout = lazy(() => import("./pages/Checkout"));
const CheckoutSuccess = lazy(() => import("./pages/CheckoutSuccess"));
const CheckoutCancel = lazy(() => import("./pages/CheckoutCancel"));
const OrderStatusPage = lazy(() => import("./pages/OrderStatus"));
const Shipping = lazy(() => import("./pages/Shipping"));
const Returns = lazy(() => import("./pages/Returns"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Contact = lazy(() => import("./pages/Contact"));
const TestConfigurator = lazy(() => import("./pages/TestConfigurator"));
const NotFound = lazy(() => import("./pages/NotFound"));
const AdminLogin = lazy(() => import("./pages/admin/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const OrderList = lazy(() => import("./pages/admin/OrderList"));
const OrderDetails = lazy(() => import("./pages/admin/OrderDetails"));
const AdminProducts = lazy(() => import("./pages/admin/AdminSettings"));
const ProtectedRoute = lazy(() => import("./components/admin/ProtectedRoute"));
const Toaster = lazy(() =>
  import("@/components/ui/toaster").then((module) => ({ default: module.Toaster }))
);
const SupabaseConfigNotice = import.meta.env.DEV
  ? lazy(() => import("@/components/SupabaseConfigNotice"))
  : null;

import ScrollToTop from "./components/ScrollToTop";
import AppErrorBoundary from "./components/AppErrorBoundary";

// Loading fallback component
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      <p className="text-sm text-muted-foreground">Laster...</p>
    </div>
  </div>
);

const ConfigureRouteFallback = () => (
  <div className="min-h-screen bg-background pt-20">
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="mb-4 text-2xl font-bold">Konfiguratoren feilet</h1>
      <p className="text-muted-foreground">
        En feil oppstod ved lasting av konfiguratoren. Oppdater siden og prove igjen.
      </p>
    </div>
  </div>
);

function RuntimeErrorLogger() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (import.meta.env.DEV) {
        console.error("[runtime-error]", {
          message: event.message,
          filename: event.filename,
          line: event.lineno,
          column: event.colno,
          stack: event.error instanceof Error ? event.error.stack : null,
        });
      }
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (import.meta.env.DEV) {
        const reason =
          event.reason instanceof Error
            ? { message: event.reason.message, stack: event.reason.stack }
            : event.reason;
        console.error("[unhandled-rejection]", reason);
      }
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 10 * 60_000,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <CartProvider>
      <RuntimeErrorLogger />
      <Suspense fallback={null}>
        <Toaster />
      </Suspense>
      {SupabaseConfigNotice ? (
        <Suspense fallback={null}>
          <SupabaseConfigNotice />
        </Suspense>
      ) : null}
      <BrowserRouter>
        <ScrollToTop />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route
              path="/configure"
              element={
                <AppErrorBoundary
                  boundaryName="configure-route"
                  fallback={<ConfigureRouteFallback />}
                >
                  <Configure />
                </AppErrorBoundary>
              }
            />
            <Route path="/cart" element={<Cart />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/checkout/success" element={<CheckoutSuccess />} />
            <Route path="/checkout/cancel" element={<CheckoutCancel />} />
            <Route path="/order-status" element={<OrderStatusPage />} />
            <Route path="/shipping" element={<Shipping />} />
            <Route path="/returns" element={<Returns />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/contact" element={<Contact />} />

            {/* Admin routes */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/orders" element={<ProtectedRoute><OrderList /></ProtectedRoute>} />
            <Route path="/admin/orders/:orderId" element={<ProtectedRoute><OrderDetails /></ProtectedRoute>} />
            <Route path="/admin/products" element={<ProtectedRoute><AdminProducts /></ProtectedRoute>} />

            {import.meta.env.DEV && <Route path="/test-configurator" element={<TestConfigurator />} />}
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </CartProvider>
  </QueryClientProvider>
);

export default App;
