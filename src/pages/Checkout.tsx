import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, CreditCard, Loader2, Truck, MapPin, Mail, Tag, Check, X } from 'lucide-react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import CartSummary from '@/components/cart/CartSummary'
import { useCart } from '@/contexts/CartContext'
import { createOrder } from '@/lib/orderService'
import { useToast } from '@/hooks/use-toast'
import { PICKUP_LOCATIONS, DeliveryMethod, ShippingAddress, BlockConfig } from '@/types/shop'
import { supabase } from '@/integrations/supabase/browserClient'
import { useSettings } from '@/hooks/useSettings'

interface CreateCheckoutResponse {
  success?: boolean
  url?: string
  sessionId?: string
  error?: {
    code?: string
    message?: string
  }
}

async function readSupabaseFunctionError(invokeError: unknown): Promise<{ code?: string; message: string }> {
  const context = (invokeError as { context?: Response } | null)?.context
  if (context) {
    try {
      const bodyText = await context.text()
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText) as { error?: { code?: string; message?: string } | string }
          if (typeof parsed?.error === 'string') {
            return { message: parsed.error }
          }
          if (parsed?.error && typeof parsed.error === 'object') {
            return { code: parsed.error.code, message: parsed.error.message ?? 'Ukjent feil' }
          }
        } catch {
          return { message: bodyText }
        }
      }
    } catch {
      // Ignore and fall through to default message.
    }
  }

  const message = invokeError instanceof Error ? invokeError.message : 'Kunne ikke opprette betalingssesjon.'
  return { message }
}

export default function Checkout() {
  const navigate = useNavigate()
  const { data: settings } = useSettings()
  const dynamicShippingCost = settings?.shipping_cost ?? 79
  const checkoutDisabled = settings?.maintenance_mode?.enabled === true
  const checkoutDisabledMessage =
    settings?.maintenance_mode?.message?.trim() ||
    'Bestilling er midlertidig satt pa pause. Prov igjen om kort tid.'
  const {
    items, 
    itemCount, 
    discountedTotal,
    deliveryMethod, 
    setDeliveryMethod, 
    isDigitalOnly,
    promoCode,
    promoDiscount,
    applyPromoCode,
    clearPromoCode,
    clearCart
  } = useCart()
  
  // Form state
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [email, setEmail] = useState('')
  const [promoInput, setPromoInput] = useState('')
  const [promoError, setPromoError] = useState('')
  
  // Shipping address state
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [city, setCity] = useState('')
  
  const [isProcessing, setIsProcessing] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'vipps' | 'card'>('vipps')
  const [digitalConsent, setDigitalConsent] = useState(false)
  const { toast } = useToast()

  const needsShippingAddress = deliveryMethod === 'shipping' && !isDigitalOnly
  const requiresDigitalConsent = items.some(item => item.product.isDigital)
  const hasPrintedItem = items.some(item => !item.product.isDigital)

  useEffect(() => {
    if (!requiresDigitalConsent) {
      setDigitalConsent(false)
    }
  }, [requiresDigitalConsent])

  const getConfigDetails = (config?: BlockConfig) => {
    if (!config) return []
    const details: string[] = [`Dybde: ${config.depth} mm`]
    if (config.widths) {
      details.push(
        `Fingerbredder (mm): ${config.widths.lillefinger} / ${config.widths.ringfinger} / ${config.widths.langfinger} / ${config.widths.pekefinger} (lille/ring/lang/peke)`
      )
    }
    if (config.heights) {
      details.push(
        `Steghøyder (mm): ${config.heights.lillefinger} / ${config.heights.ringfinger} / ${config.heights.langfinger} / ${config.heights.pekefinger} (lille/ring/lang/peke)`
      )
    }
    return details
  }

  const handleApplyPromoCode = () => {
    setPromoError('')
    if (!promoInput.trim()) return
    
    const success = applyPromoCode(promoInput.trim())
    if (!success) {
      setPromoError('Ugyldig promokode')
    } else {
      setPromoInput('')
    }
  }

  const validateForm = (): boolean => {
    if (!customerName.trim() || customerName.trim().length < 2) {
      toast({
        title: 'Navn påkrevd',
        description: 'Vennligst oppgi fullt navn (minst 2 tegn).',
        variant: 'destructive'
      })
      return false
    }

    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({
        title: 'E-post påkrevd',
        description: 'Vennligst oppgi en gyldig e-postadresse.',
        variant: 'destructive'
      })
      return false
    }

    // Require delivery method for physical products
    if (!isDigitalOnly && !deliveryMethod) {
      toast({
        title: 'Leveringsmetode påkrevd',
        description: 'Vennligst velg en leveringsmetode.',
        variant: 'destructive'
      })
      return false
    }
    
    if (requiresDigitalConsent && !digitalConsent) {
      toast({
        title: 'Samtykke påkrevd',
        description: 'Du må samtykke til levering av digitalt innhold før betaling.',
        variant: 'destructive'
      })
      return false
    }

    if (needsShippingAddress) {
      if (!addressLine1.trim()) {
        toast({
          title: 'Adresse påkrevd',
          description: 'Vennligst oppgi gateadresse for hjemlevering.',
          variant: 'destructive'
        })
        return false
      }
      if (!postalCode.trim() || !/^\d{4}$/.test(postalCode.trim())) {
        toast({
          title: 'Postnummer påkrevd',
          description: 'Vennligst oppgi et gyldig norsk postnummer (4 siffer).',
          variant: 'destructive'
        })
        return false
      }
      if (!city.trim()) {
        toast({
          title: 'Poststed påkrevd',
          description: 'Vennligst oppgi poststed.',
          variant: 'destructive'
        })
        return false
      }
    }

    return true
  }

  const handleCheckout = async () => {
    if (checkoutDisabled) {
      toast({
        title: 'Kasse er midlertidig stengt',
        description: checkoutDisabledMessage,
        variant: 'destructive'
      })
      return
    }

    if (!validateForm()) return

    const sb = supabase
    if (!sb) {
      toast({
        title: 'Konfigurasjonsfeil',
        description:
          'Kasse er utilgjengelig fordi Supabase ikke er konfigurert. Oppdater baked config i src/integrations/supabase/publicEnv.ts eller sett VITE_SUPABASE_URL + (VITE_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_ANON_KEY) der hosten stotter det.',
        variant: 'destructive'
      })
      return
    }

    setIsProcessing(true)

    const shippingAddress: ShippingAddress | undefined = needsShippingAddress 
      ? {
          line1: addressLine1.trim(),
          line2: addressLine2.trim() || undefined,
          postalCode: postalCode.trim(),
          city: city.trim()
        }
      : undefined

    try {
      const subtotalAmount = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
      const shippingAmount = isDigitalOnly ? 0 : (deliveryMethod === 'shipping' ? dynamicShippingCost : 0)
      
      // If total is 0 (100% discount), skip payment and save order directly to database
      if (discountedTotal === 0) {
        const orderId = await createOrder({
          items,
          customerName: customerName.trim(),
          customerEmail: email.trim(),
          customerPhone: customerPhone.trim() || undefined,
          deliveryMethod: deliveryMethod || 'shipping', // Default for digital products
          shippingAddress,
          promoCode: promoCode || undefined,
          promoDiscount,
          subtotal: subtotalAmount,
          shipping: shippingAmount,
          discountedTotal: 0
        })

        // Send order confirmation email (non-blocking)
        const pickupLocation = deliveryMethod.startsWith('pickup-') 
          ? PICKUP_LOCATIONS.find(loc => loc.id === deliveryMethod)?.name 
          : undefined

        sb.functions.invoke('send-order-confirmation', {
          body: {
            orderId,
            siteUrl: window.location.origin,
            customerEmail: email.trim(),
            customerName: customerName.trim(),
            items: items.map(item => ({
              name: item.product.name,
              quantity: item.quantity,
              price: item.product.price
            })),
            deliveryMethod,
            pickupLocation,
            shippingAddress,
            subtotal: subtotalAmount,
            shipping: shippingAmount,
            promoDiscount,
            total: 0
          }
        }).catch(() => {
          // Email sending is non-blocking, errors are logged server-side
        })

        // Store simplified order info for success page
        const order = {
          orderId,
          items,
          subtotal: subtotalAmount,
          shipping: shippingAmount,
          total: 0,
          email: email.trim(),
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || undefined,
          shippingAddress,
          promoCode,
          promoDiscount,
          deliveryMethod,
          createdAt: new Date().toISOString(),
          status: 'paid' as const,
          savedToDatabase: true
        }
        
        sessionStorage.setItem('bs-climbing-pending-order', JSON.stringify(order))
        clearCart()
        
        // Navigate to success page
        navigate('/checkout/success?session_id=free_order')
        return
      }

      // Create real Stripe Checkout session
      const { data, error: invokeError } = await sb.functions.invoke<CreateCheckoutResponse>('create-checkout', {
        body: {
          items: items.map(item => ({
            name: item.product.name,
            productId: item.product.id,
            price: item.product.price,
            quantity: item.quantity,
            isDigital: item.product.isDigital,
            config: item.product.config,
          })),
          customerName: customerName.trim(),
          customerEmail: email.trim(),
          customerPhone: customerPhone.trim() || undefined,
          deliveryMethod: deliveryMethod || 'shipping',
          shippingAddress,
          promoCode: promoCode || undefined,
          promoDiscount,
          shippingAmount: isDigitalOnly ? 0 : (deliveryMethod === 'shipping' ? dynamicShippingCost : 0),
          paymentMethod,
          successUrl: `${window.location.origin}/checkout/success`,
          cancelUrl: `${window.location.origin}/checkout/cancel`,
        }
      })

      if (invokeError) {
        const { code, message } = await readSupabaseFunctionError(invokeError)
        throw new Error(code ? `[${code}] ${message}` : message)
      }

      if (!data?.success || !data.url) {
        const errorMessage =
          data?.error?.code === 'CHECKOUT_DISABLED'
            ? data?.error?.message || 'Bestilling er midlertidig satt pa pause. Prov igjen om kort tid.'
            : data?.error?.code === 'PAYMENT_METHOD_UNAVAILABLE'
            ? 'Valgt betalingsmetode er ikke tilgjengelig akkurat na. Prove kort eller sjekk Stripe-oppsettet.'
            : data?.error?.message || 'Kunne ikke opprette betalingssesjon.'

        throw new Error(errorMessage)
      }

      // Redirect to Stripe Checkout
      window.location.href = data.url
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Noe gikk galt. Vennligst prov igjen.'
      toast({
        title: 'Betalingsfeil',
        description: message,
        variant: 'destructive'
      })
      setIsProcessing(false)
    }
  }

  if (itemCount === 0) {
    return (
      <>
        <Header />
        <main className="min-h-screen bg-background pt-20">
          <div className="max-w-lg mx-auto px-4 py-20 text-center">
            <h1 className="text-2xl font-bold mb-4">Handlekurven er tom</h1>
            <p className="text-muted-foreground mb-8">
              Du må legge til produkter før du kan gå til kassen.
            </p>
            <Link to="/configure" className="btn-primary">
              Gå til konfigurator
            </Link>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background pt-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Back link */}
          <Link 
            to="/cart" 
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Tilbake til handlekurv</span>
          </Link>

          <h1 className="text-3xl font-bold mb-8">Kasse</h1>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Checkout form */}
            <div className="lg:col-span-2 space-y-6">
              {/* Contact info */}
              <div className="bg-card border border-border rounded-2xl p-6">
                <h2 className="text-lg font-semibold mb-4">Kontaktinformasjon</h2>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="customerName" className="block text-sm font-medium text-foreground mb-2">
                      Fullt navn *
                    </label>
                    <input
                      type="text"
                      id="customerName"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Ola Nordmann"
                      className="w-full px-4 py-3 bg-surface-light border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
                      required
                    />
                  </div>
                  
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                      E-post *
                    </label>
                    <input
                      type="email"
                      id="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="din@epost.no"
                      className="w-full px-4 py-3 bg-surface-light border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
                      required
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      {isDigitalOnly
                        ? '3D-print-filen sendes til denne e-postadressen.'
                        : 'Du får ordrebekreftelse og oppdateringer på denne adressen.'
                      }
                    </p>
                  </div>
                  
                  <div>
                    <label htmlFor="customerPhone" className="block text-sm font-medium text-foreground mb-2">
                      Telefon <span className="text-muted-foreground">(valgfritt)</span>
                    </label>
                    <input
                      type="tel"
                      id="customerPhone"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="+47 123 45 678"
                      className="w-full px-4 py-3 bg-surface-light border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Delivery method - Only show for physical products */}
              {!isDigitalOnly && (
                <div className="bg-card border border-border rounded-2xl p-6">
                  <h2 className="text-lg font-semibold mb-4">Leveringsmetode</h2>
                  <div className="space-y-3">
                    {/* Shipping option */}
                    <button
                      onClick={() => setDeliveryMethod('shipping')}
                      className={`w-full p-4 rounded-xl border transition-all flex items-center gap-4 ${
                        deliveryMethod === 'shipping'
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="w-12 h-12 bg-surface-light rounded-xl flex items-center justify-center">
                        <Truck className="w-6 h-6 text-primary" />
                      </div>
                      <div className="text-left flex-1">
                        <div className="font-medium text-foreground">Hjemlevering</div>
                        <div className="text-sm text-muted-foreground">Sendes med Posten/Bring (3-5 dager)</div>
                      </div>
                      <div className="text-right">
                        <span className="font-medium text-foreground">{dynamicShippingCost},- kr</span>
                      </div>
                      {deliveryMethod === 'shipping' && (
                        <div className="w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </button>

                    {/* Pickup options */}
                    {PICKUP_LOCATIONS.map(location => (
                      <button
                        key={location.id}
                        onClick={() => setDeliveryMethod(location.id)}
                        className={`w-full p-4 rounded-xl border transition-all flex items-center gap-4 ${
                          deliveryMethod === location.id
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <div className="w-12 h-12 bg-surface-light rounded-xl flex items-center justify-center">
                          <MapPin className="w-6 h-6 text-valid" />
                        </div>
                        <div className="text-left flex-1">
                          <div className="font-medium text-foreground">{location.name}</div>
                          <div className="text-sm text-muted-foreground">{location.address}</div>
                          {location.description && (
                            <div className="text-xs text-muted-foreground mt-0.5">{location.description}</div>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="font-medium text-valid">Gratis</span>
                        </div>
                        {deliveryMethod === location.id && (
                          <div className="w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Shipping address - Only show for home delivery */}
              {needsShippingAddress && (
                <div className="bg-card border border-border rounded-2xl p-6">
                  <h2 className="text-lg font-semibold mb-4">Leveringsadresse</h2>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="addressLine1" className="block text-sm font-medium text-foreground mb-2">
                        Gateadresse *
                      </label>
                      <input
                        type="text"
                        id="addressLine1"
                        value={addressLine1}
                        onChange={(e) => setAddressLine1(e.target.value)}
                        placeholder="Storgata 1"
                        className="w-full px-4 py-3 bg-surface-light border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
                        required
                      />
                    </div>
                    
                    <div>
                      <label htmlFor="addressLine2" className="block text-sm font-medium text-foreground mb-2">
                        Adresselinje 2 <span className="text-muted-foreground">(valgfritt)</span>
                      </label>
                      <input
                        type="text"
                        id="addressLine2"
                        value={addressLine2}
                        onChange={(e) => setAddressLine2(e.target.value)}
                        placeholder="Leilighet, etasje, etc."
                        className="w-full px-4 py-3 bg-surface-light border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="postalCode" className="block text-sm font-medium text-foreground mb-2">
                          Postnummer *
                        </label>
                        <input
                          type="text"
                          id="postalCode"
                          value={postalCode}
                          onChange={(e) => setPostalCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          placeholder="0123"
                          maxLength={4}
                          className="w-full px-4 py-3 bg-surface-light border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
                          required
                        />
                      </div>
                      
                      <div>
                        <label htmlFor="city" className="block text-sm font-medium text-foreground mb-2">
                          Poststed *
                        </label>
                        <input
                          type="text"
                          id="city"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="Oslo"
                          className="w-full px-4 py-3 bg-surface-light border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
                          required
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Digital delivery notice */}
              {isDigitalOnly && (
                <div className="bg-card border border-border rounded-2xl p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                      <Mail className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold mb-1">Digital levering</h2>
                      <p className="text-sm text-muted-foreground">
                        3D-print-filen(e) sendes direkte til e-postadressen din etter fullført betaling.
                        Ingen frakt – ingen ventetid!
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Promo code */}
              <div className="bg-card border border-border rounded-2xl p-6">
                <h2 className="text-lg font-semibold mb-4">Promokode</h2>
                {promoCode ? (
                  <div className="flex items-center justify-between p-3 bg-valid/10 border border-valid/30 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Check className="w-5 h-5 text-valid" />
                      <span className="font-medium text-valid">{promoCode}</span>
                      <span className="text-sm text-muted-foreground">(-{Math.round(promoDiscount / (promoDiscount + discountedTotal) * 100)}%)</span>
                    </div>
                    <button
                      onClick={clearPromoCode}
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Fjern promokode"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <input
                        type="text"
                        value={promoInput}
                        onChange={(e) => {
                          setPromoInput(e.target.value.toUpperCase())
                          setPromoError('')
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && handleApplyPromoCode()}
                        placeholder="Skriv inn kode"
                        className="w-full pl-10 pr-4 py-3 bg-surface-light border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
                      />
                    </div>
                    <button
                      onClick={handleApplyPromoCode}
                      className="px-6 py-3 bg-surface-light border border-border rounded-lg font-medium text-foreground hover:border-primary hover:bg-primary/5 transition-colors"
                    >
                      Bruk
                    </button>
                  </div>
                )}
                {promoError && (
                  <p className="text-sm text-destructive mt-2">{promoError}</p>
                )}
              </div>

              {/* Payment method - Only show if not free */}
              {discountedTotal > 0 && (
                <div className="bg-card border border-border rounded-2xl p-6">
                  <h2 className="text-lg font-semibold mb-4">Betalingsmetode</h2>
                  <div className="space-y-3">
                    <button
                      onClick={() => setPaymentMethod('vipps')}
                      className={`w-full p-4 rounded-xl border transition-all flex items-center gap-4 ${
                        paymentMethod === 'vipps'
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="w-12 h-12 bg-[#FF5B24] rounded-xl flex items-center justify-center text-white font-bold text-lg">
                        V
                      </div>
                      <div className="text-left">
                        <div className="font-medium text-foreground">Vipps</div>
                        <div className="text-sm text-muted-foreground">Betal enkelt med Vipps</div>
                      </div>
                      {paymentMethod === 'vipps' && (
                        <div className="ml-auto w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </button>

                    <button
                      onClick={() => setPaymentMethod('card')}
                      className={`w-full p-4 rounded-xl border transition-all flex items-center gap-4 ${
                        paymentMethod === 'card'
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="w-12 h-12 bg-surface-light rounded-xl flex items-center justify-center">
                        <CreditCard className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <div className="text-left">
                        <div className="font-medium text-foreground">Kort / Apple Pay</div>
                        <div className="text-sm text-muted-foreground">Visa, Mastercard, Apple Pay</div>
                      </div>
                      {paymentMethod === 'card' && (
                        <div className="ml-auto w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Order items preview */}
              <div className="bg-card border border-border rounded-2xl p-6">
                <h2 className="text-lg font-semibold mb-4">Din bestilling</h2>
                <div className="space-y-3">
                  {items.map(item => {
                    const configDetails = getConfigDetails(item.product.config)
                    return (
                      <div key={item.product.id} className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-surface-light rounded-lg flex items-center justify-center shrink-0">
                          <span className="text-xl">{item.product.isDigital ? '📄' : '🧗'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-foreground text-sm truncate">
                            {item.product.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Antall: {item.quantity}
                            {item.product.isDigital && ' • Digital levering'}
                          </div>
                          {configDetails.length > 0 && (
                            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                              {configDetails.map(detail => (
                                <div key={detail}>{detail}</div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-sm font-medium text-foreground">
                          {item.product.price * item.quantity},- kr
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Order summary sidebar */}
            <div className="lg:col-span-1">
              <div className="bg-card border border-border rounded-2xl p-6 sticky top-24">
                <h2 className="text-lg font-semibold mb-4">Sammendrag</h2>
                <CartSummary />

                {requiresDigitalConsent && (
                  <label className="flex items-start gap-2 text-xs text-muted-foreground mt-4">
                    <input
                      type="checkbox"
                      checked={digitalConsent}
                      onChange={(event) => setDigitalConsent(event.target.checked)}
                      className="mt-0.5"
                    />
                    Jeg samtykker i at levering av digitalt innhold starter umiddelbart og erkjenner at angreretten dermed går tapt.
                  </label>
                )}

                {checkoutDisabled && (
                  <div className="mt-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3">
                    <p className="text-sm font-medium text-yellow-300">Kassen er midlertidig stengt</p>
                    <p className="mt-1 text-xs text-yellow-100/90">{checkoutDisabledMessage}</p>
                  </div>
                )}
                
                <button
                  onClick={handleCheckout}
                  disabled={
                    isProcessing ||
                    checkoutDisabled ||
                    !email ||
                    !customerName ||
                    (!isDigitalOnly && !deliveryMethod) ||
                    (requiresDigitalConsent && !digitalConsent)
                  }
                  className="btn-primary w-full justify-center mt-6 disabled:opacity-50"
                >
                  {checkoutDisabled ? (
                    'Kasse midlertidig stengt'
                  ) : isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Behandler...
                    </>
                  ) : discountedTotal === 0 ? (
                    'Fullfør bestilling (Gratis)'
                  ) : (
                    <>
                      {paymentMethod === 'vipps' ? 'Betal med Vipps' : 'Betal med kort / Apple Pay'}
                      <span className="ml-1">{discountedTotal},- kr</span>
                    </>
                  )}
                </button>

                {hasPrintedItem && (
                  <p className="text-xs text-muted-foreground text-center mt-4">
                    Custom vare: Produseres etter dine mål. Angrerett gjelder ikke. Reklamasjon ved feil/mangel gjelder.
                  </p>
                )}

                <p className="text-xs text-muted-foreground text-center mt-2">
                  Gratis avbestilling innen 2 timer / før produksjon starter.
                </p>

                <p className="text-xs text-muted-foreground text-center mt-4">
                  Ved å fullføre kjøpet godtar du våre{' '}
                  <Link to="/terms" className="text-primary hover:underline">vilkår</Link>
                  {' '}og{' '}
                  <Link to="/privacy" className="text-primary hover:underline">personvernerklæring</Link>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
