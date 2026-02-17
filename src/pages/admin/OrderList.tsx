import { useState, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { format } from 'date-fns'
import { nb } from 'date-fns/locale'
import { Search, ChevronRight, Filter, Download, MoreHorizontal, Trash2 } from 'lucide-react'
import AdminLayout from '@/components/admin/AdminLayout'
import OrderStatusBadge from '@/components/admin/OrderStatusBadge'
import { useOrders, useBulkUpdateOrderStatus, useBulkDeleteOrders } from '@/hooks/useOrders'
import { OrderStatus, ORDER_STATUS_LABELS, DELIVERY_METHOD_LABELS, ConfigSnapshot } from '@/types/admin'
import { downloadFusionParameterCSV, downloadMultipleFusionCSVs } from '@/lib/fusionCsvExport'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'

const ALL_STATUSES: OrderStatus[] = [
  'new', 'manual_review', 'in_production', 'ready_to_print', 'printing', 'shipped', 'done', 'error'
]

function getConfigSnapshot(order: { config_snapshot: unknown }): ConfigSnapshot | null {
  try {
    return order.config_snapshot as ConfigSnapshot
  } catch {
    return null
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Ukjent feil.'
}

export default function OrderList() {
  const [searchParams, setSearchParams] = useSearchParams()
  const statusFilter = searchParams.get('status') as OrderStatus | null
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const { data: orders, isLoading } = useOrders()
  const bulkUpdateStatus = useBulkUpdateOrderStatus()
  const bulkDelete = useBulkDeleteOrders()
  const { toast } = useToast()

  const filteredOrders = useMemo(() => {
    if (!orders) return []

    return orders.filter(order => {
      // Status filter
      if (statusFilter && order.status !== statusFilter) return false

      // Search filter
      if (search) {
        const q = search.toLowerCase()
        return (
          order.id.toLowerCase().includes(q) ||
          order.customer_name.toLowerCase().includes(q) ||
          order.customer_email.toLowerCase().includes(q)
        )
      }

      return true
    })
  }, [orders, statusFilter, search])

  const handleStatusChange = (value: string) => {
    if (value === 'all') {
      searchParams.delete('status')
    } else {
      searchParams.set('status', value)
    }
    setSearchParams(searchParams)
  }

  const toggleSelect = (orderId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) {
        next.delete(orderId)
      } else {
        next.add(orderId)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredOrders.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredOrders.map(o => o.id)))
    }
  }

  const handleBulkDownload = async () => {
    const ordersToDownload = filteredOrders
      .filter(order => selectedIds.has(order.id))
      .map(order => {
        const config = getConfigSnapshot(order)
        const item = config?.items?.[0]
        return item
          ? {
              item,
              orderId: order.id,
              customerName: order.customer_name,
              customerEmail: order.customer_email,
              fallbackProductionNumber: order.production_number,
            }
          : null
      })
      .filter((o): o is {
        item: ConfigSnapshot['items'][0]
        orderId: string
        customerName: string
        customerEmail: string
        fallbackProductionNumber: number | null
      } => o !== null)

    if (ordersToDownload.length === 0) {
      toast({ title: 'Ingen ordre å eksportere', description: 'Velg minst én ordre med konfigurasjon.' })
      return
    }

    try {
      await downloadMultipleFusionCSVs(ordersToDownload)
    } catch (error) {
      toast({ title: 'Eksport feilet', description: getErrorMessage(error), variant: 'destructive' })
    }
  }

  const handleBulkStatusChange = async (status: OrderStatus) => {
    const orderIds = Array.from(selectedIds)
    try {
      await bulkUpdateStatus.mutateAsync({ orderIds, status })
      toast({ title: `${orderIds.length} ordre(r) oppdatert til "${ORDER_STATUS_LABELS[status]}"` })
      setSelectedIds(new Set())
    } catch {
      toast({ title: 'Feil ved oppdatering', variant: 'destructive' })
    }
  }

  const handleBulkDelete = async () => {
    const orderIds = Array.from(selectedIds)
    if (!confirm(`Er du sikker på at du vil slette ${orderIds.length} ordre(r)? Dette kan ikke angres.`)) {
      return
    }
    try {
      await bulkDelete.mutateAsync(orderIds)
      toast({ title: `${orderIds.length} ordre(r) slettet` })
      setSelectedIds(new Set())
    } catch {
      toast({ title: 'Feil ved sletting', variant: 'destructive' })
    }
  }

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Ordrer</h1>
        <p className="text-muted-foreground">
          {filteredOrders.length} ordre{filteredOrders.length !== 1 ? 'r' : ''}
          {statusFilter && ` med status "${ORDER_STATUS_LABELS[statusFilter]}"`}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Søk etter ordre-ID, navn eller e-post..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={statusFilter ?? 'all'} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Alle statuser" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statuser</SelectItem>
              {ALL_STATUSES.map(status => (
                <SelectItem key={status} value={status}>
                  {ORDER_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedIds.size > 0 && (
          <>
            <Button onClick={handleBulkDownload} variant="default" className="gap-2">
              <Download className="w-4 h-4" />
              Last ned {selectedIds.size} CSV{selectedIds.size > 1 ? '-er' : ''}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <MoreHorizontal className="w-4 h-4" />
                  Handlinger ({selectedIds.size})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Endre status til</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {ALL_STATUSES.map(status => (
                      <DropdownMenuItem key={status} onClick={() => handleBulkStatusChange(status)}>
                        {ORDER_STATUS_LABELS[status]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleBulkDelete} className="text-destructive focus:text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Slett valgte
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {/* Orders table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Laster ordrer...</div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {search || statusFilter ? 'Ingen ordrer matcher søket' : 'Ingen ordrer ennå'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-light/50">
                  <th className="w-10 px-4 py-3">
                    <Checkbox
                      checked={selectedIds.size === filteredOrders.length && filteredOrders.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Ordre</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Dato</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Kunde</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Levering</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-muted-foreground">Total</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map(order => (
                  <tr
                    key={order.id}
                    className="border-b border-border last:border-0 hover:bg-surface-light/30 transition-colors"
                  >
                    <td className="px-4 py-4">
                      <Checkbox
                        checked={selectedIds.has(order.id)}
                        onCheckedChange={() => toggleSelect(order.id)}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <Link to={`/admin/orders/${order.id}`} className="font-mono text-sm text-primary hover:underline">
                        {order.id.slice(0, 8)}...
                      </Link>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">
                      {format(new Date(order.created_at), 'd. MMM yyyy HH:mm', { locale: nb })}
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-sm font-medium">{order.customer_name}</div>
                      <div className="text-xs text-muted-foreground">{order.customer_email}</div>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">
                      {DELIVERY_METHOD_LABELS[order.delivery_method] ?? order.delivery_method}
                    </td>
                    <td className="px-4 py-4">
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-4 text-right font-medium">
                      {(order.total_amount / 100).toFixed(0)},- kr
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        {(() => {
                          const config = getConfigSnapshot(order)
                          const item = config?.items?.[0]
                          if (!item) return null
                          return (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={async (e) => {
                                e.preventDefault()
                                try {
                                  await downloadFusionParameterCSV(
                                    item,
                                    order.id,
                                    order.customer_name,
                                    order.customer_email,
                                    {
                                      fallbackProductionNumber: order.production_number
                                    }
                                  )
                                } catch (error) {
                                  toast({
                                    title: 'Eksport feilet',
                                    description: getErrorMessage(error),
                                    variant: 'destructive'
                                  })
                                }
                              }}
                              title="Eksporter Fusion CSV"
                            >
                              <Download className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                            </Button>
                          )
                        })()}
                        <Link to={`/admin/orders/${order.id}`}>
                          <ChevronRight className="w-5 h-5 text-muted-foreground hover:text-foreground" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
