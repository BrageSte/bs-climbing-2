import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import * as THREE from 'three'
import { format } from 'date-fns'
import { nb } from 'date-fns/locale'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import OrderStatusBadge from '@/components/admin/OrderStatusBadge'
import { DELIVERY_METHOD_LABELS, ORDER_STATUS_LABELS } from '@/types/admin'
import type { OrderStatus, ConfigSnapshot } from '@/types/admin'
import { supabase } from '@/integrations/supabase/browserClient'

interface OrderStatusResponse {
  order?: {
    id: string
    createdAt: string
    status: OrderStatus
    productionNumber?: number | null
    deliveryMethod: string
    pickupLocation?: string | null
    shippingAddress?: Record<string, unknown> | null
    lineItems?: Array<{ name: string; quantity: number; price: number }> | null
    configSnapshot?: ConfigSnapshot | null
    subtotalAmount: number
    shippingAmount: number
    totalAmount: number
    customerName?: string | null
  }
  queue?: {
    position?: number
    ahead?: number
    total?: number
    basis?: 'printing' | 'ready_to_print' | 'in_production'
  } | null
  error?: string
  code?: string
}

const STATUS_STEPS: { status: OrderStatus; title: string; description: string }[] = [
  { status: 'new', title: 'Bestilling mottatt', description: 'Ordren er registrert og ligger i kø.' },
  { status: 'manual_review', title: 'Gjennomgang', description: 'Vi dobbeltsjekker detaljer før produksjon.' },
  { status: 'in_production', title: 'I produksjon', description: 'Produksjonen er i gang.' },
  { status: 'ready_to_print', title: 'Klar til print', description: 'Klar til å gå i printkø.' },
  { status: 'printing', title: 'Printer', description: 'Grepet ditt printes nå.' },
  { status: 'shipped', title: 'Sendt', description: 'Pakken er på vei eller klar for henting.' },
  { status: 'done', title: 'Fullført', description: 'Ordren er ferdigstilt.' },
]

const formatNok = (amountOre: number) => `${(amountOre / 100).toLocaleString('nb-NO')},- kr`

const normalizeErrorMessage = (raw?: string) => {
  if (!raw) return 'Kunne ikke hente ordrestatus'
  const value = raw.toLowerCase()
  if (value.includes('order not found')) return 'Fant ingen ordre med det ordrenummeret'
  if (value.includes('orderid is required')) return 'Skriv inn ordrenummeret fra e-posten'
  if (value.includes('configuration missing')) return 'Tjenesten mangler oppsett. Prøv igjen senere'
  if (value.includes('database error')) return 'Det oppstod en databasefeil. Prøv igjen senere'
  return raw
}

function ModelMesh({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url)
  const meshRef = useRef<THREE.Mesh>(null)

  const { centeredGeometry, scale } = useMemo(() => {
    const centered = geometry.clone()
    centered.center()
    centered.computeBoundingBox()
    const box = centered.boundingBox
    if (!box) {
      return { centeredGeometry: centered, scale: 1 }
    }
    const size = new THREE.Vector3()
    box.getSize(size)
    const maxAxis = Math.max(size.x, size.y, size.z) || 1
    return { centeredGeometry: centered, scale: 1.4 / maxAxis }
  }, [geometry])

  useFrame((state, delta) => {
    if (!meshRef.current) return
    meshRef.current.rotation.y += delta * 0.35
    meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.4) * 0.15
  })

  return (
    <mesh ref={meshRef} geometry={centeredGeometry} scale={scale}>
      <meshStandardMaterial color="#ff6b35" metalness={0.15} roughness={0.35} />
    </mesh>
  )
}

function OrderModelPreview({ blockVariant }: { blockVariant?: 'shortedge' | 'longedge' | null }) {
  const modelUrl = blockVariant === 'longedge' ? '/models/blokk_longedge.stl' : '/models/blokk_shortedge.stl'

  return (
    <div className="relative h-64 w-full overflow-hidden rounded-2xl border border-border bg-surface-light">
      <Canvas camera={{ position: [0, 0, 2.2], fov: 50 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[2, 2, 3]} intensity={1.1} />
        <Suspense fallback={null}>
          <ModelMesh url={modelUrl} />
        </Suspense>
        <OrbitControls enableZoom={false} enablePan={false} autoRotate={false} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/40 via-transparent to-transparent" />
    </div>
  )
}

export default function OrderStatusPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialOrderId = searchParams.get('orderId') ?? ''
  const [orderIdInput, setOrderIdInput] = useState(initialOrderId)
  const [statusData, setStatusData] = useState<OrderStatusResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!initialOrderId) return
    void fetchOrderStatus(initialOrderId)
  }, [initialOrderId])

  const fetchOrderStatus = async (orderId: string) => {
    setIsLoading(true)
    setError('')
    setStatusData(null)

    const sb = supabase
    if (!sb) {
      setError(
        'Ordrestatus er utilgjengelig fordi Supabase ikke er konfigurert. Sett VITE_SUPABASE_URL og VITE_SUPABASE_PUBLISHABLE_KEY i Lovable Project Settings.'
      )
      setIsLoading(false)
      return
    }

    const { data, error: invokeError } = await sb.functions.invoke('get-order-status', {
      body: { orderId }
    })

    if (invokeError) {
      let statusText = ''
      let serverMessage = ''
      let serverCode = ''
      const context = (invokeError as { context?: Response }).context
      if (context) {
        const statusInfo = context.status ? ` ${context.status}${context.statusText ? ` ${context.statusText}` : ''}` : ''
        statusText = statusInfo ? ` (HTTP ${statusInfo.trim()})` : ''
        try {
          const bodyText = await context.text()
          if (bodyText) {
            const parsed = JSON.parse(bodyText) as { error?: string; code?: string }
            serverMessage = parsed.error ?? ''
            serverCode = parsed.code ?? ''
          }
        } catch {
          // Ignore parse failures
        }
      }

      const normalizedMessage = normalizeErrorMessage(serverMessage || invokeError.message)
      const codeLabel = serverCode ? ` Feilkode: ${serverCode}.` : ' Feilkode: OS_EDGE_HTTP_ERROR.'
      setError(`${normalizedMessage}.${codeLabel}${statusText}`)
      setIsLoading(false)
      return
    }

    if (!data?.order) {
      const normalizedMessage = normalizeErrorMessage(data?.error)
      const codeLabel = data?.code ? ` Feilkode: ${data.code}.` : ' Feilkode: OS_NOT_FOUND.'
      setError(`${normalizedMessage}.${codeLabel}`)
      setIsLoading(false)
      return
    }

    setStatusData(data as OrderStatusResponse)
    setIsLoading(false)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = orderIdInput.trim()
    if (!trimmed) {
      setError('Skriv inn ordrenummeret fra e-posten.')
      return
    }
    if (trimmed === initialOrderId) {
      await fetchOrderStatus(trimmed)
      return
    }
    setSearchParams({ orderId: trimmed })
  }

  const order = statusData?.order
  const queue = statusData?.queue
  const statusIndex = order ? STATUS_STEPS.findIndex(step => step.status === order.status) : -1
  const showQueue = order ? ['printing', 'ready_to_print', 'in_production'].includes(order.status) : false
  const queueStepLabel = order ? ORDER_STATUS_LABELS[order.status] : ''
  const primaryConfigItem = order?.configSnapshot?.items?.[0]

  const shippingAddress = useMemo(() => {
    if (!order?.shippingAddress || typeof order.shippingAddress !== 'object') return null
    return order.shippingAddress as Record<string, string>
  }, [order?.shippingAddress])

  const lineItems = Array.isArray(order?.lineItems) ? order?.lineItems : []

  const formattedDate = order?.createdAt
    ? format(new Date(order.createdAt), "d. MMMM yyyy 'kl.' HH:mm", { locale: nb })
    : ''

  const productionNumber = order?.productionNumber
    ? order.productionNumber.toString().padStart(4, '0')
    : null
  const variantLabel = primaryConfigItem?.blockVariant
    ? primaryConfigItem.blockVariant === 'longedge' ? 'Long Edge' : 'Compact'
    : 'Ukjent'

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background pt-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              <section className="bg-card border border-border rounded-2xl p-6">
                <h1 className="text-3xl font-bold mb-2">Sjekk ordrestatus</h1>
                <p className="text-muted-foreground mb-6">
                  Bruk ordrenummeret fra ordrebekreftelsen. Du får opp status, printkø og alle viktige detaljer.
                </p>
                <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Input
                    value={orderIdInput}
                    onChange={(event) => setOrderIdInput(event.target.value)}
                    placeholder="F.eks. 5b71c4bb-0aa0-4db8-8d60-..."
                    className="flex-1"
                    aria-label="Ordrenummer"
                  />
                  <Button type="submit" className="sm:w-auto w-full">
                    Sjekk ordrestatus
                  </Button>
                </form>
                {error && (
                  <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </div>
                )}
              </section>

              {isLoading && (
                <section className="bg-card border border-border rounded-2xl p-6 text-muted-foreground">
                  Laster ordrestatus ...
                </section>
              )}

              {order && (
                <>
                  <section className="bg-card border border-border rounded-2xl p-6">
                    {/* Prominent order ID + customer name header */}
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                      <div>
                        {order.customerName && (
                          <p className="text-lg font-semibold text-foreground mb-1">{order.customerName}</p>
                        )}
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">Ordre-ID</p>
                        <p className="font-mono text-sm text-foreground bg-surface-light border border-border rounded-lg px-3 py-1.5 inline-block select-all">{order.id}</p>
                      </div>
                      <OrderStatusBadge status={order.status} />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-xl border border-border bg-surface-light p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Opprettet</p>
                        <p className="text-sm font-medium text-foreground">{formattedDate}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-surface-light p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Produksjonsnummer</p>
                        <p className="text-sm font-medium text-foreground">
                          {productionNumber ?? 'Oppdateres når produksjon starter'}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="bg-card border border-border rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold">Printkø</h2>
                      {queue?.position && (
                        <span className="text-sm text-muted-foreground">#{queue.position} i køen</span>
                      )}
                    </div>
                    {showQueue && queue ? (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground">
                          Kø for status: <span className="text-foreground">{queueStepLabel}</span>
                        </p>
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div className="rounded-xl border border-border bg-surface-light p-4">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Din plass</p>
                            <p className="text-2xl font-semibold text-foreground">{queue.position}</p>
                          </div>
                          <div className="rounded-xl border border-border bg-surface-light p-4">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Foran deg</p>
                            <p className="text-2xl font-semibold text-foreground">{queue.ahead ?? 0}</p>
                          </div>
                          <div className="rounded-xl border border-border bg-surface-light p-4">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">I print nå</p>
                            <p className="text-2xl font-semibold text-foreground">{queue.total ?? 0}</p>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Køen beregnes innenfor dette steget basert på produksjonsnummer.
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-border bg-surface-light p-4 text-sm text-muted-foreground">
                        Ordren behandles i rekkefølgen den ble lagt inn. Opprettelsesdatoen er din plass i køen.
                      </div>
                    )}
                  </section>

                  <section className="bg-card border border-border rounded-2xl p-6">
                    <h2 className="text-lg font-semibold mb-4">Statusløp</h2>
                    <div className="space-y-3">
                      {STATUS_STEPS.map((step, index) => {
                        const isActive = statusIndex >= 0 && index <= statusIndex
                        const isCurrent = order.status === step.status
                        return (
                          <div
                            key={step.status}
                            className={`flex items-start gap-3 rounded-xl border p-3 ${
                              isCurrent
                                ? 'border-primary/40 bg-primary/10'
                                : isActive
                                  ? 'border-border bg-surface-light'
                                  : 'border-border/60 bg-background'
                            }`}
                          >
                            <div className={`mt-1 h-2.5 w-2.5 rounded-full ${isActive ? 'bg-primary' : 'bg-border'}`} />
                            <div>
                              <div className="text-sm font-medium text-foreground">{step.title}</div>
                              <div className="text-xs text-muted-foreground">{step.description}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {order.status === 'error' && (
                      <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                        Det oppstod en feil i ordrebehandlingen. Ta kontakt, så hjelper vi deg.
                      </div>
                    )}
                  </section>

                  <section className="bg-card border border-border rounded-2xl p-6">
                    <h2 className="text-lg font-semibold mb-4">Ordredetaljer</h2>
                    <div className="space-y-3">
                      {lineItems.map((item, index) => (
                        <div key={`${item.name}-${index}`} className="flex items-center justify-between text-sm">
                          <div>
                            <div className="font-medium text-foreground">{item.name}</div>
                            <div className="text-xs text-muted-foreground">Antall: {item.quantity}</div>
                          </div>
                          <div className="text-sm text-foreground">{formatNok(item.price * item.quantity)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-border mt-4 pt-4 space-y-2 text-sm">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Delsum</span>
                        <span>{formatNok(order.subtotalAmount)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Frakt</span>
                        <span>{formatNok(order.shippingAmount)}</span>
                      </div>
                      <div className="flex justify-between font-medium text-foreground pt-2 border-t border-border">
                        <span>Totalt</span>
                        <span className="text-primary">{formatNok(order.totalAmount)}</span>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </div>

            <aside className="space-y-6">
              <section className="bg-card border border-border rounded-2xl p-6">
                <h2 className="text-lg font-semibold mb-4">Din Stepper</h2>
                {order ? (
                  <>
                    <OrderModelPreview blockVariant={primaryConfigItem?.blockVariant} />
                    <div className="mt-4 grid gap-2 text-sm">
                      {order.customerName && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Kunde</span>
                          <span className="text-foreground font-medium">{order.customerName}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Variant</span>
                        <span className="text-foreground">{variantLabel}</span>
                      </div>
                      {primaryConfigItem?.depth && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Dybde</span>
                          <span className="text-foreground">{primaryConfigItem.depth} mm</span>
                        </div>
                      )}
                      {primaryConfigItem?.totalWidth && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Total bredde</span>
                          <span className="text-foreground">{primaryConfigItem.totalWidth.toFixed(1)} mm</span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-border bg-surface-light p-4 text-sm text-muted-foreground">
                    Fyll inn ordrenummeret for å se modellen din her.
                  </div>
                )}
              </section>

              {order && (
                <section className="bg-card border border-border rounded-2xl p-6">
                  <h2 className="text-lg font-semibold mb-4">Levering</h2>
                  <div className="space-y-3 text-sm">
                    <div>
                      <div className="text-muted-foreground">Leveringsmetode</div>
                      <div className="text-foreground">
                        {DELIVERY_METHOD_LABELS[order.deliveryMethod] ?? order.deliveryMethod}
                      </div>
                    </div>
                    {order.pickupLocation && (
                      <div>
                        <div className="text-muted-foreground">Hentested</div>
                        <div className="text-foreground">{order.pickupLocation}</div>
                      </div>
                    )}
                    {shippingAddress && (
                      <div>
                        <div className="text-muted-foreground">Adresse</div>
                        <div className="text-foreground">{shippingAddress.line1}</div>
                        {shippingAddress.line2 && (
                          <div className="text-foreground">{shippingAddress.line2}</div>
                        )}
                        {(shippingAddress.postalCode || shippingAddress.postal_code || shippingAddress.city) && (
                          <div className="text-foreground">
                            {shippingAddress.postalCode || shippingAddress.postal_code} {shippingAddress.city}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              )}
            </aside>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
