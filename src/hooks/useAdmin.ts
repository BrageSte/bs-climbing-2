import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'

function getSupabaseOrThrow() {
  if (!supabase) {
    throw new Error('Supabase er ikke konfigurert. Admin-innlogging er utilgjengelig i denne hosten.')
  }
  return supabase
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setUser(null)
      setLoading(false)
      return
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  return { user, loading }
}

export function useIsAdmin() {
  const { user, loading: authLoading } = useAuth()

  const { data: isAdmin, isLoading: roleLoading } = useQuery({
    queryKey: ['isAdmin', user?.id],
    queryFn: async () => {
      if (!user) return false

      const sb = getSupabaseOrThrow()
      const { data, error } = await sb.rpc('is_admin')

      if (error) {
        return false
      }

      return data === true
    },
    enabled: !!user
  })

  return {
    isAdmin: isAdmin ?? false,
    loading: authLoading || roleLoading,
    user
  }
}

export async function signIn(email: string, password: string) {
  const sb = getSupabaseOrThrow()
  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password
  })

  if (error) throw error
  return data
}

export async function signOut() {
  const sb = getSupabaseOrThrow()
  const { error } = await sb.auth.signOut()
  if (error) throw error
}
