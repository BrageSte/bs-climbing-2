import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { requireSupabase } from '@/integrations/supabase/client'
import { OrderRow, OrderStatus } from '@/types/admin'

export function useOrders(statusFilter?: OrderStatus) {
  return useQuery({
    queryKey: ['orders', statusFilter],
    queryFn: async () => {
      const sb = requireSupabase()
      let query = sb
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })

      if (statusFilter) {
        query = query.eq('status', statusFilter)
      }

      const { data, error } = await query

      if (error) throw error
      return data as OrderRow[]
    }
  })
}

export function useOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: async () => {
      if (!orderId) return null

      const sb = requireSupabase()
      const { data, error } = await sb
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single()

      if (error) throw error
      return data as OrderRow
    },
    enabled: !!orderId
  })
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
      const sb = requireSupabase()
      const { error } = await sb
        .from('orders')
        .update({ status })
        .eq('id', orderId)

      if (error) throw error
    },
    onSuccess: (_, { orderId }) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['order', orderId] })
    }
  })
}

export function useUpdateOrderNotes() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orderId, notes }: { orderId: string; notes: string }) => {
      const sb = requireSupabase()
      const { error } = await sb
        .from('orders')
        .update({ internal_notes: notes })
        .eq('id', orderId)

      if (error) throw error
    },
    onSuccess: (_, { orderId }) => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] })
    }
  })
}

export function useBulkUpdateOrderStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orderIds, status }: { orderIds: string[]; status: OrderStatus }) => {
      const sb = requireSupabase()
      const { error } = await sb
        .from('orders')
        .update({ status })
        .in('id', orderIds)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    }
  })
}

export function useBulkDeleteOrders() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (orderIds: string[]) => {
      const sb = requireSupabase()
      const { error } = await sb
        .from('orders')
        .delete()
        .in('id', orderIds)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    }
  })
}
