import { supabase } from '@/integrations/supabase/browserClient'
import { ConfigSnapshotItem } from '@/types/admin'

/**
 * Downloads a Fusion 360 parameter CSV for a crimp block configuration.
 * Format matches Fusion 360's "Export Parameters" CSV format exactly.
 */
type ProductionAssignment = {
  productionNumber: number
  modellId: string
}

type DownloadOptions = {
  assignment?: ProductionAssignment
  fallbackProductionNumber?: number | null
}

export async function downloadFusionParameterCSV(
  item: ConfigSnapshotItem,
  orderId: string,
  customerName: string,
  customerEmail: string,
  options?: DownloadOptions
): Promise<void> {
  const resolvedAssignment = options?.assignment
    ?? await resolveProductionAssignment(orderId, options?.fallbackProductionNumber)
  const edgeMode = resolveEdgeMode(item.blockVariant)
  const header = 'Name,Unit,Expression,Value,Comments,Favorite'

  const rows = [
    formatRow('PekefingerBredde', item.widths.pekefinger),
    formatRow('LillefingerBredde', item.widths.lillefinger),
    formatRow('RingefingerBredde', item.widths.ringfinger),
    formatRow('LangefingerBredde', item.widths.langfinger),
    formatRow('LillefingerHoyde', item.heights.lillefinger),
    formatRow('PekefingerHoyde', item.heights.pekefinger),
    formatRow('LangefingerHoyde', item.heights.langfinger),
    formatRow('RingefingerHoyde', item.heights.ringfinger),
    formatRow('LongShort_Edge', item.blockVariant === 'longedge' ? 50 : 35),
    formatScalarRow('EdgeMode', edgeMode),
    formatTextRow('ModellID', resolvedAssignment.modellId),
  ]

  const csv = [header, ...rows].join('\n')
  const filename = buildFusionCsvFilename(customerName, customerEmail, resolvedAssignment.modellId, orderId)
  downloadCSV(csv, filename)
}

function formatRow(name: string, value: number): string {
  return `${name},mm,${value} mm,${value.toFixed(2)},,TRUE`
}

function formatScalarRow(name: string, value: number): string {
  return `${name},,${value},${value},,TRUE`
}

function formatTextRow(name: string, value: string): string {
  const quoted = `"${value}"`
  return `${name},,${quoted},${quoted},,TRUE`
}

function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Downloads multiple Fusion 360 parameter CSVs with a small delay between each.
 */
export async function downloadMultipleFusionCSVs(
  orders: Array<{
    item: ConfigSnapshotItem
    orderId: string
    customerName: string
    customerEmail: string
    fallbackProductionNumber?: number | null
  }>
): Promise<void> {
  const assigned: Array<{
    item: ConfigSnapshotItem
    orderId: string
    customerName: string
    customerEmail: string
  } & ProductionAssignment> = []

  for (const order of orders) {
    const assignment = await resolveProductionAssignment(order.orderId, order.fallbackProductionNumber)
    assigned.push({
      item: order.item,
      orderId: order.orderId,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      ...assignment,
    })
  }

  assigned.sort((a, b) => a.productionNumber - b.productionNumber)

  for (let i = 0; i < assigned.length; i++) {
    const { item, orderId, customerName, customerEmail, productionNumber, modellId } = assigned[i]
    await downloadFusionParameterCSV(item, orderId, customerName, customerEmail, {
      assignment: { productionNumber, modellId }
    })
    // Small delay between downloads to avoid browser blocking
    if (i < assigned.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
}

export function toSafeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('@', '-at-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'ukjent'
}

export function buildOrderConfirmationCode(orderId: string): string {
  return `ORDER${orderId.slice(0, 8).toUpperCase()}`
}

export function buildFusionCsvFilename(
  customerName: string,
  customerEmail: string,
  modellId: string,
  orderId: string
): string {
  const nameSlug = toSafeSlug(customerName)
  const emailSlug = toSafeSlug(customerEmail)
  const orderCode = buildOrderConfirmationCode(orderId)
  return `${nameSlug}-${emailSlug}_${modellId}_${orderCode}.csv`
}

async function resolveProductionAssignment(
  orderId: string,
  fallbackProductionNumber?: number | null
): Promise<ProductionAssignment> {
  const fallback = normalizeProductionNumber(fallbackProductionNumber)
  if (fallback !== null) {
    return {
      productionNumber: fallback,
      modellId: formatModelId(fallback),
    }
  }

  if (!supabase) {
    throw new Error('Supabase er ikke konfigurert. Kan ikke tildele produksjonsnummer i denne hosten.')
  }
  const sb = supabase
  const { data, error } = await sb
    .rpc('assign_production_number', { order_id: orderId })

  const productionNumber = normalizeProductionNumber(data?.[0]?.production_number)
  if (error || productionNumber === null) {
    if (isAfterTriggerOutsideQueryError(error?.message)) {
      const temporaryModelId = formatTemporaryModelId(orderId)
      console.warn('[fusion-csv] assign_production_number failed with trigger error. Using temporary model id.', {
        orderId,
        error: error?.message,
        temporaryModelId
      })
      return {
        productionNumber: Number.MAX_SAFE_INTEGER,
        modellId: temporaryModelId,
      }
    }
    throw new Error(error?.message ?? 'Kunne ikke tildele produksjonsnummer.')
  }

  return {
    productionNumber,
    modellId: formatModelId(productionNumber),
  }
}

function normalizeProductionNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function formatModelId(productionNumber: number): string {
  return `BS-${productionNumber.toString().padStart(4, '0')}`
}

function formatTemporaryModelId(orderId: string): string {
  return `BS-TMP-${orderId.slice(0, 8).toUpperCase()}`
}

function isAfterTriggerOutsideQueryError(message: string | undefined): boolean {
  return Boolean(message && message.includes('AfterTriggerSaveEvent() called outside of query'))
}

function resolveEdgeMode(variant: unknown): number {
  if (typeof variant === 'number') {
    if (variant === 0 || variant === 1) return variant
  }
  if (typeof variant === 'string') {
    const normalized = variant.toLowerCase()
    if (normalized.includes('long')) return 1
    if (normalized.includes('short')) return 0
  }
  return 0
}
