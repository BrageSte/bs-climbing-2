// Shop types for e-commerce functionality

export interface Product {
  id: string
  name: string
  description: string
  price: number // in NOK (øre for Stripe later)
  variant?: string
  image?: string
  isDigital?: boolean // true for STL files
  // Custom block configuration
  config?: BlockConfig
}

export interface BlockConfig {
  blockVariant: 'shortedge' | 'longedge'
  widths: {
    lillefinger: number
    ringfinger: number
    langfinger: number
    pekefinger: number
  }
  heights: {
    lillefinger: number
    ringfinger: number
    langfinger: number
    pekefinger: number
  }
  depth: number
  totalWidth: number
}

export interface CartItem {
  product: Product
  quantity: number
}

export type DeliveryMethod = 'shipping' | 'pickup-gneis' | 'pickup-oslo' | null

export interface PickupLocation {
  id: DeliveryMethod
  name: string
  address: string
  description?: string
}

export const PICKUP_LOCATIONS: PickupLocation[] = [
  {
    id: 'pickup-gneis',
    name: 'Gneis Lilleaker',
    address: 'Lilleakerveien 31, 0283 Oslo',
    description: 'Hent i resepsjonen'
  },
  {
    id: 'pickup-oslo',
    name: 'Oslo Klatresenter',
    address: 'Sigurd Hoels vei 2, 0655 Oslo',
    description: 'Hent i proshopen'
  }
]

export interface ShippingAddress {
  line1: string
  line2?: string
  postalCode: string
  city: string
}

export interface Order {
  orderId: string
  items: CartItem[]
  subtotal: number
  shipping: number
  total: number
  email?: string
  customerName?: string
  customerPhone?: string
  shippingAddress?: ShippingAddress
  promoCode?: string
  promoDiscount?: number
  deliveryMethod?: DeliveryMethod
  createdAt: string
  status: 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled'
  savedToDatabase?: boolean
}

export const SHIPPING_COST = 79 // Fast frakt i Norge

// Check if cart contains only digital products
export function isDigitalOnlyCart(items: CartItem[]): boolean {
  return items.every(item => item.product.isDigital === true)
}

// Get shipping cost based on delivery method and cart contents
export function getShippingCost(items: CartItem[], deliveryMethod: DeliveryMethod): number {
  if (isDigitalOnlyCart(items)) {
    return 0 // Digital products = no shipping
  }
  if (!deliveryMethod) {
    return 0 // No delivery method selected yet
  }
  if (deliveryMethod === 'pickup-gneis' || deliveryMethod === 'pickup-oslo') {
    return 0 // Pickup = free
  }
  return SHIPPING_COST
}

export function getDeliveryMethodLabel(method: DeliveryMethod): string {
  if (method === 'shipping') return 'Hjemlevering'
  const pickup = PICKUP_LOCATIONS.find(l => l.id === method)
  return pickup ? `Henting: ${pickup.name}` : 'Levering'
}

export function generateProductId(config: BlockConfig, orderType: 'file' | 'printed'): string {
  const { blockVariant, widths, depth } = config
  const widthSum = Object.values(widths).join('-')
  return `${orderType}-${blockVariant}-${widthSum}-${depth}-${Date.now()}`
}

export function generateOrderId(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `BS-${timestamp}-${random}`
}
