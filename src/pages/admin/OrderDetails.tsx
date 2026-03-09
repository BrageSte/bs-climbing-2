import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { format } from 'date-fns'
import { nb } from 'date-fns/locale'
import {
  ArrowLeft,
  ArrowUpRight,
  User,
  Mail,
  Phone,
  MapPin,
  Package,
  Copy,
  Check,
  Save,
  Download
} from 'lucide-react'
import AdminLayout from '@/components/admin/AdminLayout'
import OrderStatusBadge from '@/components/admin/OrderStatusBadge'
import { useOrder, useUpdateOrderStatus, useUpdateOrderNotes } from '@/hooks/useOrders'
import { 
  OrderStatus, 
  ORDER_STATUS_LABELS, 
  DELIVERY_METHOD_LABELS,
  ConfigSnapshot,
  ShippingAddress 
} from '@/types/admin'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { downloadFusionParameterCSV } from '@/lib/fusionCsvExport'

const ALL_STATUSES: OrderStatus[] = [
  'new', 'manual_review', 'in_production', 'ready_to_print', 'printing', 'shipped', 'done', 'error'
]

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Ukjent feil.'
}

export default function OrderDetails() {
  const { orderId } = useParams<{ orderId: string }>()
  const { data: order, isLoading } = useOrder(orderId)
  const updateStatus = useUpdateOrderStatus()
  const updateNotes = useUpdateOrderNotes()
  const { toast } = useToast()

  const [notes, setNotes] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Parse JSON fields
  const configSnapshot = useMemo<ConfigSnapshot | null>(() => {
    if (!order?.config_snapshot) return null
    try {
      return order.config_snapshot as unknown as ConfigSnapshot
    } catch {
      return null
    }
  }, [order])

  const shippingAddress = useMemo<ShippingAddress | null>(() => {
    if (!order?.shipping_address) return null
    try {
      return order.shipping_address as unknown as ShippingAddress
    } catch {
      return null
    }
  }, [order])

  const handleStatusChange = async (status: OrderStatus) => {
    if (!orderId) return
    try {
      await updateStatus.mutateAsync({ orderId, status })
      toast({ title: 'Status oppdatert' })
    } catch {
      toast({ title: 'Feil', description: 'Kunne ikke oppdatere status', variant: 'destructive' })
    }
  }

  const handleExport = async (item: ConfigSnapshot['items'][0]) => {
    if (!order) return
    try {
      await downloadFusionParameterCSV(item, order.id, order.customer_name, order.customer_email, {
        fallbackProductionNumber: order.production_number
      })
    } catch (error) {
      toast({ title: 'Eksport feilet', description: getErrorMessage(error), variant: 'destructive' })
    }
  }

  const handleSaveNotes = async () => {
    if (!orderId || notes === null) return
    try {
      await updateNotes.mutateAsync({ orderId, notes })
      toast({ title: 'Notater lagret' })
    } catch {
      toast({ title: 'Feil', description: 'Kunne ikke lagre notater', variant: 'destructive' })
    }
  }

  const copyConfig = () => {
    if (!configSnapshot?.items?.[0]) return

    const item = configSnapshot.items[0]
    const text = `
BLOKK-KONFIGURASJON
-------------------
Ordre: ${order?.id.slice(0, 8)}

Type: ${item.blockVariant === 'shortedge' ? 'Compact' : 'Long Edge'}

Bredder (mm):
  Lillefinger: ${item.widths.lillefinger}
  Ringfinger: ${item.widths.ringfinger}
  Langfinger: ${item.widths.langfinger}
  Pekefinger: ${item.widths.pekefinger}

Høyder (mm):
  Lillefinger: ${item.heights.lillefinger}
  Ringfinger: ${item.heights.ringfinger}
  Langfinger: ${item.heights.langfinger}
  Pekefinger: ${item.heights.pekefinger}

Dybde: ${item.depth} mm
Total bredde: ${item.totalWidth.toFixed(1)} mm
`.trim()

    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast({ title: 'Konfigurasjon kopiert' })
  }

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="text-muted-foreground">Laster ordre...</div>
      </AdminLayout>
    )
  }

  if (!order) {
    return (
      <AdminLayout>
        <div className="text-muted-foreground">Ordre ikke funnet</div>
      </AdminLayout>
    )
  }

  const currentNotes = notes ?? order.internal_notes ?? ''
  const shippingPostalCode = shippingAddress?.postalCode ?? shippingAddress?.postal_code

  return (
    <AdminLayout>
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <Link to="/admin/orders" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="w-4 h-4" />
            Tilbake til ordrer
          </Link>
          <h1 className="text-2xl font-bold mb-1">
            Ordre #{order.id.slice(0, 8)}
          </h1>
          <div className="text-muted-foreground">
            {format(new Date(order.created_at), "d. MMMM yyyy 'kl.' HH:mm", { locale: nb })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <a href={`/order-status?orderId=${order.id}`} target="_blank" rel="noreferrer">
              Se kundens ordrestatus
              <ArrowUpRight className="w-4 h-4" />
            </a>
          </Button>
          <OrderStatusBadge status={order.status} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer info */}
          <section className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-semibold mb-4">Kundeinformasjon</h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-muted-foreground" />
                <span>{order.customer_name}</span>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <a href={`mailto:${order.customer_email}`} className="text-primary hover:underline">
                  {order.customer_email}
                </a>
              </div>
              {order.customer_phone && (
                <div className="flex items-center gap-3">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <a href={`tel:${order.customer_phone}`} className="text-primary hover:underline">
                    {order.customer_phone}
                  </a>
                </div>
              )}
            </div>
          </section>

          {/* Delivery */}
          <section className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-semibold mb-4">Levering</h2>
            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
              <div>
                <div className="font-medium mb-1">
                  {DELIVERY_METHOD_LABELS[order.delivery_method] ?? order.delivery_method}
                </div>
                {shippingAddress && (
                  <div className="text-sm text-muted-foreground">
                    {shippingAddress.line1 && <div>{shippingAddress.line1}</div>}
                    {shippingAddress.line2 && <div>{shippingAddress.line2}</div>}
                    {(shippingPostalCode || shippingAddress.city) && (
                      <div>{shippingPostalCode} {shippingAddress.city}</div>
                    )}
                    {shippingAddress.country && <div>{shippingAddress.country}</div>}
                  </div>
                )}
                {order.pickup_location && (
                  <div className="text-sm text-muted-foreground">{order.pickup_location}</div>
                )}
              </div>
            </div>
          </section>

          {/* Config */}
          {configSnapshot?.items?.map((item, index) => (
            <section key={index} className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  Produktkonfigurasjon
                </h2>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void handleExport(item)
                    }}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Eksporter Fusion CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={copyConfig}>
                    {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                    {copied ? 'Kopiert!' : 'Kopier'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Blokk</div>
                  <div className="font-medium">
                    {item.blockVariant === 'shortedge' ? 'Compact' : 'Long Edge'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Type</div>
                  <div className="font-medium">
                    {item.type === 'printed' ? 'Printet produkt' : 'STL-fil'}
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-6">
                <div>
                  <div className="text-sm text-muted-foreground mb-3">Bredder (mm)</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Lillefinger</span>
                      <span className="font-mono">{item.widths.lillefinger}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ringfinger</span>
                      <span className="font-mono">{item.widths.ringfinger}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Langfinger</span>
                      <span className="font-mono">{item.widths.langfinger}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pekefinger</span>
                      <span className="font-mono">{item.widths.pekefinger}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-sm text-muted-foreground mb-3">Høyder (mm)</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Lillefinger</span>
                      <span className="font-mono">{item.heights.lillefinger}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ringfinger</span>
                      <span className="font-mono">{item.heights.ringfinger}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Langfinger</span>
                      <span className="font-mono">{item.heights.langfinger}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pekefinger</span>
                      <span className="font-mono">{item.heights.pekefinger}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-border grid grid-cols-2 gap-6">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Dybde</div>
                  <div className="font-mono font-medium">{item.depth} mm</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Total bredde</div>
                  <div className="font-mono font-medium">{item.totalWidth.toFixed(1)} mm</div>
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status */}
          <section className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-semibold mb-4">Ordrestatus</h2>
            <Select value={order.status} onValueChange={handleStatusChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_STATUSES.map(status => (
                  <SelectItem key={status} value={status}>
                    {ORDER_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          {/* Totals */}
          <section className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-semibold mb-4">Betalingsdetaljer</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{(order.subtotal_amount / 100).toFixed(0)},- kr</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Frakt</span>
                <span className={order.shipping_amount === 0 ? 'text-valid' : ''}>
                  {order.shipping_amount === 0 ? 'Gratis' : `${(order.shipping_amount / 100).toFixed(0)},- kr`}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-border font-medium">
                <span>Totalt</span>
                <span className="text-primary">{(order.total_amount / 100).toFixed(0)},- kr</span>
              </div>
            </div>
          </section>

          {/* Notes */}
          <section className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-semibold mb-4">Interne notater</h2>
            <Textarea
              placeholder="Legg til notater her..."
              value={currentNotes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
              className="mb-3"
            />
            <Button 
              onClick={handleSaveNotes} 
              disabled={notes === null || notes === (order.internal_notes ?? '')}
              size="sm"
              className="w-full"
            >
              <Save className="w-4 h-4 mr-2" />
              Lagre notater
            </Button>
          </section>
        </div>
      </div>
    </AdminLayout>
  )
}
