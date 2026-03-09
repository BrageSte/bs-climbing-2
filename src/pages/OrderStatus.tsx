import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { nb } from 'date-fns/locale'
import { Lock } from 'lucide-react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import OrderStatusBadge from '@/components/admin/OrderStatusBadge'
import { DELIVERY_METHOD_LABELS, ORDER_STATUS_LABELS } from '@/types/admin'
import type { OrderStatus } from '@/types/admin'
import { supabase } from '@/integrations/supabase/browserClient'

interface OrderStatusResponse {
  success?: boolean
  order?: {
    id: string
    createdAt: string
    status: OrderStatus
    productionNumber?: number | null
    deliveryMethod: string
    pickupLocation?: string | null
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

const ORDER_STATUS_TOKEN_KEY_PREFIX = 'bs-order-status-token-'

function getStoredToken(orderId: string): string {
  if (typeof window === 'undefined' || !orderId) return ''
  try {
    return sessionStorage.getItem(`${ORDER_STATUS_TOKEN_KEY_PREFIX}${orderId}`) ?? ''
  } catch {
    return ''
  }
}

function storeToken(orderId: string, token: string) {
  if (typeof window === 'undefined' || !orderId || !token) return
  try {
    sessionStorage.setItem(`${ORDER_STATUS_TOKEN_KEY_PREFIX}${orderId}`, token)
  } catch {
    // Ignore storage failures.
  }
}

function normalizeErrorMessage(raw?: string) {
  if (!raw) return 'Kunne ikke hente ordrestatus'
  const value = raw.toLowerCase()
  if (value.includes('missing authorization')) return 'Mangler sikkerhetskode. Åpne lenken fra ordrebekreftelsen.'
  if (value.includes('unauthorized')) return 'Ugyldig sikkerhetskode. Åpne lenken fra ordrebekreftelsen.'
  if (value.includes('order not found')) return 'Fant ingen ordre med det ordrenummeret'
  if (value.includes('orderid is required')) return 'Skriv inn ordrenummeret fra e-posten'
  if (value.includes('configuration missing')) return 'Tjenesten mangler oppsett. Prøv igjen senere'
  if (value.includes('database error')) return 'Det oppstod en databasefeil. Prøv igjen senere'
  return raw
}

export default function OrderStatusPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialOrderId = searchParams.get('orderId')?.trim() ?? ''
  const initialTokenFromQuery = searchParams.get('token')?.trim() ?? ''
  const initialToken = initialTokenFromQuery || getStoredToken(initialOrderId)

  const [orderIdInput, setOrderIdInput] = useState(initialOrderId)
  const [tokenInput, setTokenInput] = useState(initialToken)
  const [statusData, setStatusData] = useState<OrderStatusResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!initialTokenFromQuery) return
    if (initialOrderId) {
      storeToken(initialOrderId, initialTokenFromQuery)
    }

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('token')
    setSearchParams(nextParams, { replace: true })
  }, [initialOrderId, initialTokenFromQuery, searchParams, setSearchParams])

  useEffect(() => {
    if (!initialOrderId || !initialToken) return
    void fetchOrderStatus(initialOrderId, initialToken)
  }, [initialOrderId, initialToken])

  const fetchOrderStatus = async (orderId: string, token: string) => {
    setIsLoading(true)
    setError('')
    setStatusData(null)
    try {
      const sb = supabase
      if (!sb) {
        setError(
          'Ordrestatus er utilgjengelig fordi Supabase ikke er konfigurert. Oppdater baked config i src/integrations/supabase/publicEnv.ts eller sett VITE_SUPABASE_URL + (VITE_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_ANON_KEY) der hosten stotter det.'
        )
        return
      }

      const trimmedToken = token.trim()
      if (!trimmedToken) {
        setError('Mangler sikkerhetskode. Åpne lenken fra ordrebekreftelsen på e-post.')
        return
      }

      const { data, error: invokeError } = await sb.functions.invoke('get-order-status', {
        body: { orderId },
        // Do not override `Authorization` (Supabase uses it for JWT verification). Send our HMAC token
        // in a custom header that the edge function explicitly whitelists for CORS.
        headers: { 'x-order-status-token': trimmedToken },
      })

      if (invokeError) {
        let serverMessage = ''
        let serverCode = ''
        const context = (invokeError as { context?: Response }).context
        if (context) {
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
        setError(`${normalizedMessage}.${codeLabel}`)
        return
      }

      if (!data?.order) {
        const normalizedMessage = normalizeErrorMessage(data?.error)
        const codeLabel = data?.code ? ` Feilkode: ${data.code}.` : ' Feilkode: OS_NOT_FOUND.'
        setError(`${normalizedMessage}.${codeLabel}`)
        return
      }

      setStatusData(data as OrderStatusResponse)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ukjent feil'
      const normalizedMessage = normalizeErrorMessage(message)
      setError(`${normalizedMessage}. Feilkode: OS_RUNTIME_ERROR.`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmedOrderId = orderIdInput.trim()
    const trimmedToken = tokenInput.trim()

    if (!trimmedOrderId) {
      setError('Skriv inn ordrenummeret fra e-posten.')
      return
    }

    if (!trimmedToken) {
      setError('Mangler sikkerhetskode. Åpne lenken fra ordrebekreftelsen på e-post.')
      return
    }

    storeToken(trimmedOrderId, trimmedToken)
    setSearchParams({ orderId: trimmedOrderId })
    await fetchOrderStatus(trimmedOrderId, trimmedToken)
  }

  const order = statusData?.order
  const queue = statusData?.queue
  const statusIndex = order ? STATUS_STEPS.findIndex(step => step.status === order.status) : -1
  const showQueue = order ? ['printing', 'ready_to_print', 'in_production'].includes(order.status) : false
  const queueStepLabel = order ? ORDER_STATUS_LABELS[order.status] : ''

  const formattedDate = order?.createdAt
    ? format(new Date(order.createdAt), "d. MMMM yyyy 'kl.' HH:mm", { locale: nb })
    : ''

  const productionNumber = order?.productionNumber
    ? order.productionNumber.toString().padStart(4, '0')
    : null

  const deliveryLabel = order?.deliveryMethod && order.deliveryMethod in DELIVERY_METHOD_LABELS
    ? DELIVERY_METHOD_LABELS[order.deliveryMethod as keyof typeof DELIVERY_METHOD_LABELS]
    : 'Levering'

  const pickupLocationLabel = order?.pickupLocation?.trim() ? order.pickupLocation : null

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background pt-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-6">
          <section className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Lock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold mb-1">Sjekk ordrestatus</h1>
                <p className="text-muted-foreground">
                  Ordrestatus er beskyttet med en sikkerhetskode. Bruk lenken fra ordrebekreftelsen på e-post.
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">Ordrenummer</label>
                <Input
                  value={orderIdInput}
                  onChange={(event) => setOrderIdInput(event.target.value)}
                  placeholder="UUID fra e-posten"
                  aria-label="Ordrenummer"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">Sikkerhetskode</label>
                <Input
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                  placeholder="token=... fra lenken"
                  aria-label="Sikkerhetskode"
                />
              </div>
              <Button type="submit" className="sm:w-auto w-full">
                Sjekk
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
                <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">Ordre-ID</p>
                    <p className="font-mono text-sm text-foreground bg-surface-light border border-border rounded-lg px-3 py-1.5 inline-block select-all">
                      {order.id}
                    </p>
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
                  <div className="rounded-xl border border-border bg-surface-light p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Leveringsmetode</p>
                    <p className="text-sm font-medium text-foreground">{deliveryLabel}</p>
                    {pickupLocationLabel && (
                      <p className="text-xs text-muted-foreground mt-1">{pickupLocationLabel}</p>
                    )}
                  </div>
                </div>
              </section>

              {showQueue && (
                <section className="bg-card border border-border rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">Printkø</h2>
                    {queue?.position && (
                      <span className="text-sm text-muted-foreground">#{queue.position} i køen</span>
                    )}
                  </div>
                  {queue ? (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        Kø for status: <span className="text-foreground">{queueStepLabel}</span>
                      </p>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="rounded-xl border border-border bg-surface-light p-4">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Din plass</p>
                          <p className="text-2xl font-semibold text-foreground">{queue.position ?? '-'}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-surface-light p-4">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Foran deg</p>
                          <p className="text-2xl font-semibold text-foreground">{queue.ahead ?? '-'}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-surface-light p-4">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">I samme steg</p>
                          <p className="text-2xl font-semibold text-foreground">{queue.total ?? '-'}</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Køen beregnes innenfor dette steget basert på produksjonsnummer.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border bg-surface-light p-4 text-sm text-muted-foreground">
                      Køinformasjon er ikke tilgjengelig enda.
                    </div>
                  )}
                </section>
              )}

              {statusIndex >= 0 && (
                <section className="bg-card border border-border rounded-2xl p-6">
                  <h2 className="text-lg font-semibold mb-4">Status</h2>
                  <ol className="space-y-3">
                    {STATUS_STEPS.map((step, index) => {
                      const isDone = index < statusIndex
                      const isCurrent = index === statusIndex
                      return (
                        <li key={step.status} className="flex gap-3">
                          <div
                            className={[
                              'mt-0.5 h-6 w-6 rounded-full border flex items-center justify-center text-xs font-bold',
                              isDone ? 'bg-valid/20 border-valid text-valid' : '',
                              isCurrent ? 'bg-primary/15 border-primary text-primary' : '',
                              !isDone && !isCurrent ? 'bg-surface-light border-border text-muted-foreground' : ''
                            ].join(' ')}
                          >
                            {index + 1}
                          </div>
                          <div>
                            <div className="font-medium text-foreground">{step.title}</div>
                            <div className="text-sm text-muted-foreground">{step.description}</div>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                </section>
              )}
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}
