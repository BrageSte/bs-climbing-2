import { requireSupabase } from '@/integrations/supabase/client'
import { CartItem, DeliveryMethod, ShippingAddress, PICKUP_LOCATIONS } from '@/types/shop'

export interface CreateOrderParams {
  items: CartItem[]
  customerName: string
  customerEmail: string
  customerPhone?: string
  deliveryMethod: DeliveryMethod
  shippingAddress?: ShippingAddress
  promoCode?: string
  promoDiscount: number
  subtotal: number
  shipping: number
  discountedTotal: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function assertCheckoutAvailable() {
  const sb = requireSupabase()
  const { data, error } = await sb
    .from('site_settings')
    .select('value')
    .eq('key', 'maintenance_mode')
    .maybeSingle()

  if (error || !data) return

  const value = data.value
  if (!isRecord(value) || value.enabled !== true) return

  const message =
    typeof value.message === 'string' && value.message.trim()
      ? value.message.trim().slice(0, 240)
      : 'Bestilling er midlertidig satt pa pause. Prov igjen om kort tid.'

  throw new Error(message)
}

export async function createOrder(params: CreateOrderParams): Promise<string> {
  await assertCheckoutAvailable()

  const {
    items,
    customerName,
    customerEmail,
    customerPhone,
    deliveryMethod,
    shippingAddress,
    promoCode,
    promoDiscount,
    subtotal,
    shipping,
    discountedTotal
  } = params

  // Map cart items to line_items format (prices in øre)
  const lineItems = items.map(item => ({
    name: item.product.name,
    quantity: item.quantity,
    price: item.product.price * 100, // Convert to øre
    productId: item.product.id
  }))

  // Map to config_snapshot format
  const configSnapshot = {
    version: 1,
    items: items.map(item => ({
      productId: item.product.id,
      type: item.product.isDigital ? 'file' : 'printed',
      blockVariant: item.product.config?.blockVariant,
      widths: item.product.config?.widths,
      heights: item.product.config?.heights,
      depth: item.product.config?.depth,
      totalWidth: item.product.config?.totalWidth,
      quantity: item.quantity,
      unitPrice: item.product.price * 100
    })),
    promoCode: promoCode || null,
    promoDiscount: promoDiscount * 100 // Store in øre
  }

  // Get pickup location name if applicable
  const pickupLocation = deliveryMethod.startsWith('pickup-')
    ? PICKUP_LOCATIONS.find(loc => loc.id === deliveryMethod)?.name || null
    : null

  // Build shipping address JSON for database
  const shippingAddressJson = shippingAddress ? {
    line1: shippingAddress.line1,
    line2: shippingAddress.line2 || null,
    postalCode: shippingAddress.postalCode,
    city: shippingAddress.city
  } : null

  // Generate a unique order ID client-side since anon users can't SELECT after INSERT
  const orderId = crypto.randomUUID()

  const sb = requireSupabase()
  const { error } = await sb
    .from('orders')
    .insert({
      id: orderId,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone || null,
      delivery_method: deliveryMethod,
      pickup_location: pickupLocation,
      shipping_address: shippingAddressJson,
      line_items: lineItems,
      config_snapshot: configSnapshot,
      subtotal_amount: subtotal * 100,
      shipping_amount: shipping * 100,
      total_amount: discountedTotal * 100,
      status: 'new',
      stripe_checkout_session_id: `free_order_${Date.now()}`
    })

  if (error) {
    // Only log details in development mode to prevent information leakage
    if (import.meta.env.DEV) {
      console.error('Error creating order:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      })
    }
    throw new Error('Kunne ikke opprette ordre. Vennligst prøv igjen senere.')
  }

  return orderId
}
