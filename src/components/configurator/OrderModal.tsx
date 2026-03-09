import { useState } from 'react'
import { X } from 'lucide-react'
import type { BlockVariant } from './StlViewer'
import { DEFAULT_BLOCK_OPTIONS } from './BlockSelector'

interface OrderModalProps {
  orderType: 'file' | 'printed'
  blockVariant: BlockVariant
  widths: {
    lillefinger: number
    ringfinger: number
    langfinger: number
    pekefinger: number
  }
  calculatedHeights: {
    lillefinger: number
    ringfinger: number
    langfinger: number
    pekefinger: number
  }
  heightDiffs: {
    lilleToRing: number
    ringToLang: number
    langToPeke: number
  }
  depth: number
  totalWidth: number
  onClose: () => void
  onComplete: () => void
}

export default function OrderModal({
  orderType,
  blockVariant,
  widths,
  calculatedHeights,
  heightDiffs,
  depth,
  totalWidth,
  onClose,
  onComplete
}: OrderModalProps) {
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [quantity, setQuantity] = useState(1)

  const blockOption = DEFAULT_BLOCK_OPTIONS.find(o => o.variant === blockVariant)
  const blockName = blockOption?.name ?? 'Compact'
  const blockPrice = blockOption?.price ?? 399
  
  const price = orderType === 'file' ? 199 : blockPrice
  const productName = orderType === 'file' ? 'Digital 3D-print-fil (print selv)' : `Ferdig printet (sendes hjem / hentes) - ${blockName}`

  const submitOrder = () => {
    const subject = encodeURIComponent(`Bestilling: Custom Crimp Blokk - ${productName}`)
    const body = encodeURIComponent(`
BESTILLING - CUSTOM CRIMP BLOKK
================================

Kunde: ${customerName}
E-post: ${customerEmail}

Produkt: ${productName}
Blokktype: ${blockName}
Antall: ${quantity}
Pris per stk: ${price} kr
Totalpris: ${price * quantity} kr

MÅL (bredde × input (total høyde)):
----
Pekefinger:   ${widths.pekefinger}×${heightDiffs.langToPeke}(${calculatedHeights.pekefinger})mm
Langfinger:   ${widths.langfinger}×${heightDiffs.ringToLang}(${calculatedHeights.langfinger})mm
Ringfinger:   ${widths.ringfinger}×${heightDiffs.lilleToRing}(${calculatedHeights.ringfinger})mm
Lillefinger:  ${widths.lillefinger}(${calculatedHeights.lillefinger})mm (fast)

Dybde: ${depth}mm
Beregnet totalbredde: ${totalWidth.toFixed(1)}mm

--------------------------------
Sendt fra Crimp Block Configurator
    `.trim())

    window.location.href = `mailto:post@bsclimbing.no?subject=${subject}&body=${body}`
    onComplete()
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-foreground">Fullfør bestilling</h3>
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="bg-surface-light rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground">{productName}</span>
            <span className="text-2xl font-bold text-foreground">{price},-</span>
          </div>
          {orderType === 'printed' && (
            <div className="text-sm text-muted-foreground">
              Blokktype: <span className="text-foreground">{blockName}</span>
            </div>
          )}
        </div>
        
        <div className="space-y-4">
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Navn"
            className="w-full px-4 py-3 bg-surface-light border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
          />
          <input
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            placeholder="E-post"
            className="w-full px-4 py-3 bg-surface-light border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
          />
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground">Antall:</span>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-20 px-3 py-2 bg-surface-light border border-border rounded-lg text-foreground text-center font-mono focus:border-primary focus:outline-none transition-colors"
            />
            <span className="text-foreground font-bold ml-auto text-lg">
              = {price * quantity},-
            </span>
          </div>
        </div>
        
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 border border-border text-muted-foreground rounded-xl hover:bg-surface-light transition-colors"
          >
            Avbryt
          </button>
          <button
            onClick={submitOrder}
            disabled={!customerName || !customerEmail}
            className="flex-1 px-4 py-3 bg-primary text-primary-foreground font-medium rounded-xl hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send bestilling
          </button>
        </div>
      </div>
    </div>
  )
}
