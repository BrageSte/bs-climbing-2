// Admin types for order management

import { Database } from '@/integrations/supabase/types'

export type OrderStatus = Database['public']['Enums']['order_status']
export type AppRole = Database['public']['Enums']['app_role']

export type OrderRow = Database['public']['Tables']['orders']['Row']
export type OrderEventRow = Database['public']['Tables']['order_events']['Row']

export interface ConfigSnapshotItem {
  productId: string
  type: 'printed' | 'file'
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
  quantity: number
  unitPrice: number
}

export interface ConfigSnapshot {
  version: number
  items: ConfigSnapshotItem[]
}

export interface ShippingAddress {
  name?: string
  line1?: string
  line2?: string
  city?: string
  postalCode?: string
  postal_code?: string
  country?: string
}

export interface LineItem {
  name: string
  quantity: number
  price: number
  productId?: string
}

// Site settings types
export interface ProductSetting {
  variant: 'shortedge' | 'longedge'
  name: string
  price: number
  description: string
}

export interface PromoCodeSetting {
  type: 'percent' | 'fixed'
  value: number
}

export interface MaintenanceModeSetting {
  enabled: boolean
  message: string
}

export interface SiteSettings {
  products: ProductSetting[]
  stl_file_price: number
  shipping_cost: number
  promo_codes: Record<string, PromoCodeSetting>
  maintenance_mode: MaintenanceModeSetting
}

// Status labels in Norwegian
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Ny',
  manual_review: 'Manuell gjennomgang',
  in_production: 'I produksjon',
  ready_to_print: 'Klar til print',
  printing: 'Printer',
  shipped: 'Sendt',
  done: 'Fullført',
  error: 'Feil',
  arkivert: 'Arkivert',
  reklamasjon: 'Reklamasjon'
}

// Status colors for badges
export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  new: 'bg-primary/20 text-primary border-primary/30',
  manual_review: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  in_production: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  ready_to_print: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  printing: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  shipped: 'bg-valid/20 text-valid border-valid/30',
  done: 'bg-muted text-muted-foreground border-border',
  error: 'bg-destructive/20 text-destructive border-destructive/30',
  arkivert: 'bg-muted text-muted-foreground border-border',
  reklamasjon: 'bg-orange-500/20 text-orange-400 border-orange-500/30'
}

// Delivery method labels
export const DELIVERY_METHOD_LABELS: Record<string, string> = {
  shipping: 'Hjemlevering',
  'pickup-gneis': 'Henting: Gneis Lilleaker',
  'pickup-oslo': 'Henting: Oslo Klatresenter',
  digital: 'Digital levering'
}
