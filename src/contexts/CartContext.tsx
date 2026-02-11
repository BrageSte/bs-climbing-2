'use client'

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react'
import { CartItem, Product, DeliveryMethod, isDigitalOnlyCart } from '@/types/shop'
import { useSettings, DEFAULT_SETTINGS } from '@/hooks/useSettings'

interface CartContextType {
  items: CartItem[]
  itemCount: number
  subtotal: number
  shipping: number
  total: number
  deliveryMethod: DeliveryMethod
  setDeliveryMethod: (method: DeliveryMethod) => void
  isDigitalOnly: boolean
  addToCart: (product: Product, quantity?: number) => void
  removeFromCart: (productId: string) => void
  updateQuantity: (productId: string, quantity: number) => void
  clearCart: () => void
  isCartOpen: boolean
  setIsCartOpen: (open: boolean) => void
  // Promo code functionality
  promoCode: string | null
  promoDiscount: number
  discountedTotal: number
  applyPromoCode: (code: string) => Promise<boolean>
  clearPromoCode: () => void
}

const CartContext = createContext<CartContextType | undefined>(undefined)

const CART_STORAGE_KEY = 'bs-climbing-cart'

export function CartProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useSettings()
  const shippingCost = settings?.shipping_cost ?? DEFAULT_SETTINGS.shipping_cost

  const [items, setItems] = useState<CartItem[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>(null)
  const [promoCode, setPromoCode] = useState<string | null>(null)
  const [promoDiscount, setPromoDiscount] = useState(0)

  // Load cart from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CART_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          setItems(parsed)
        }
      }
    } catch {
      // Ignore localStorage errors
    }
    setIsHydrated(true)
  }, [])

  // Save cart to localStorage whenever it changes
  useEffect(() => {
    if (isHydrated) {
      try {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items))
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [items, isHydrated])

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)
  
  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  
  const isDigitalOnly = useMemo(() => isDigitalOnlyCart(items), [items])
  
  const shipping = useMemo(() => {
    if (items.length === 0) return 0
    if (isDigitalOnlyCart(items)) return 0
    if (!deliveryMethod) return 0
    if (deliveryMethod === 'pickup-gneis' || deliveryMethod === 'pickup-oslo') return 0
    return shippingCost
  }, [items, deliveryMethod, shippingCost])
  
  const total = subtotal + shipping

  const discountedTotal = Math.max(0, total - promoDiscount)

  const applyPromoCode = useCallback(
    async (code: string): Promise<boolean> => {
      const normalizedCode = code.toUpperCase().trim()
      if (!normalizedCode) return false

      const { supabase } = await import('@/integrations/supabase/browserClient')
      if (!supabase) return false

      const sb = supabase

      try {
        const { data, error } = await sb.functions.invoke('validate-promo', {
          body: { promoCode: normalizedCode, totalNok: total }
        })

        if (error || !data?.success) return false

        if (data.valid === true && typeof data.discountNok === 'number' && data.discountNok > 0) {
          setPromoCode(typeof data.normalizedCode === 'string' ? data.normalizedCode : normalizedCode)
          setPromoDiscount(Math.round(data.discountNok))
          return true
        }

        return false
      } catch {
        return false
      }
    },
    [total]
  )

  const clearPromoCode = useCallback(() => {
    setPromoCode(null)
    setPromoDiscount(0)
  }, [])

  useEffect(() => {
    if (!promoCode) return

    let cancelled = false

    void (async () => {
      const { supabase } = await import('@/integrations/supabase/browserClient')
      const sb = supabase
      if (!sb || cancelled) return
      try {
        const { data, error } = await sb.functions.invoke('validate-promo', {
          body: { promoCode, totalNok: total }
        })

        if (cancelled) return
        if (error || !data?.success) return

        if (data.valid === true && typeof data.discountNok === 'number' && data.discountNok > 0) {
          setPromoDiscount(Math.round(data.discountNok))
          return
        }

        // Promo code was removed/invalidated server-side; clear it client-side too.
        setPromoCode(null)
        setPromoDiscount(0)
      } catch {
        // Keep the existing discount on transient failures.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [promoCode, total])

  const addToCart = useCallback((product: Product, quantity = 1) => {
    setItems(prev => {
      const existing = prev.find(item => item.product.id === product.id)
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        )
      }
      return [...prev, { product, quantity }]
    })
    setIsCartOpen(true)
  }, [])

  const removeFromCart = useCallback((productId: string) => {
    setItems(prev => prev.filter(item => item.product.id !== productId))
  }, [])

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId)
      return
    }
    setItems(prev =>
      prev.map(item =>
        item.product.id === productId
          ? { ...item, quantity }
          : item
      )
    )
  }, [removeFromCart])

  const clearCart = useCallback(() => {
    setItems([])
    setDeliveryMethod(null)
    setPromoCode(null)
    setPromoDiscount(0)
  }, [])

  return (
    <CartContext.Provider
      value={{
        items,
        itemCount,
        subtotal,
        shipping,
        total,
        deliveryMethod,
        setDeliveryMethod,
        isDigitalOnly,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        isCartOpen,
        setIsCartOpen,
        promoCode,
        promoDiscount,
        discountedTotal,
        applyPromoCode,
        clearPromoCode,
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const context = useContext(CartContext)
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider')
  }
  return context
}
