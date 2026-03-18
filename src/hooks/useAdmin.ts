import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/browserClient'
import { useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import {
  resolveAdminMfaState,
  type AdminMfaResolution,
  type AuthenticatorAssuranceLevel,
} from '@/lib/adminMfa'

type TotpFactor = {
  id: string
  friendlyName: string | null
}

type AdminMfaState = {
  currentLevel: AuthenticatorAssuranceLevel
  nextLevel: AuthenticatorAssuranceLevel
  verifiedFactors: TotpFactor[]
}

function getSupabaseOrThrow() {
  if (!supabase) {
    throw new Error('Supabase er ikke konfigurert. Admin-innlogging er utilgjengelig i denne hosten.')
  }
  return supabase
}

function toTotpFactor(value: unknown): TotpFactor | null {
  if (!value || typeof value !== 'object') return null

  const factor = value as {
    id?: unknown
    friendly_name?: unknown
  }

  if (typeof factor.id !== 'string' || !factor.id.trim()) return null

  return {
    id: factor.id,
    friendlyName: typeof factor.friendly_name === 'string' && factor.friendly_name.trim()
      ? factor.friendly_name
      : null,
  }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [authTick, setAuthTick] = useState(0)

  useEffect(() => {
    if (!supabase) {
      setUser(null)
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
      setAuthTick((previous) => previous + 1)
    })

    return () => subscription.unsubscribe()
  }, [])

  return { user, loading, authTick }
}

export function useAdminAccess() {
  const { user, loading: authLoading, authTick } = useAuth()

  const adminQuery = useQuery({
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
    enabled: !!user,
  })

  const mfaQuery = useQuery({
    queryKey: ['adminMfaState', user?.id, authTick],
    queryFn: async (): Promise<AdminMfaState> => {
      const sb = getSupabaseOrThrow()
      const [{ data: factorsData, error: factorsError }, { data: assuranceData, error: assuranceError }] =
        await Promise.all([
          sb.auth.mfa.listFactors(),
          sb.auth.mfa.getAuthenticatorAssuranceLevel(),
        ])

      if (factorsError) throw factorsError
      if (assuranceError) throw assuranceError

      const verifiedFactors = Array.isArray(factorsData?.totp)
        ? factorsData.totp
            .map((factor) => toTotpFactor(factor))
            .filter((factor): factor is TotpFactor => factor !== null)
        : []

      return {
        currentLevel: assuranceData?.currentLevel ?? null,
        nextLevel: assuranceData?.nextLevel ?? null,
        verifiedFactors,
      }
    },
    enabled: !!user && adminQuery.data === true,
    staleTime: 0,
  })

  const currentLevel = mfaQuery.data?.currentLevel ?? null
  const nextLevel = mfaQuery.data?.nextLevel ?? null
  const verifiedFactors = mfaQuery.data?.verifiedFactors ?? []
  const loading = authLoading || adminQuery.isLoading || (adminQuery.data === true && mfaQuery.isLoading)
  const resolution: AdminMfaResolution = resolveAdminMfaState({
    loading,
    hasUser: Boolean(user),
    isAdmin: adminQuery.data === true,
    currentLevel,
    nextLevel,
    verifiedFactorCount: verifiedFactors.length,
  })

  return {
    user,
    isAdmin: adminQuery.data === true,
    loading,
    currentLevel,
    nextLevel,
    assuranceLevel: currentLevel,
    verifiedFactors,
    needsMfaEnrollment: resolution === 'setup',
    needsMfaChallenge: resolution === 'verify',
    resolution,
    error: adminQuery.error ?? mfaQuery.error ?? null,
    refetch: async () => {
      await adminQuery.refetch()
      if (adminQuery.data === true || user) {
        await mfaQuery.refetch()
      }
    },
  }
}

export function useIsAdmin() {
  const access = useAdminAccess()
  return {
    isAdmin: access.isAdmin,
    loading: access.loading,
    user: access.user,
  }
}

export async function signIn(email: string, password: string) {
  const sb = getSupabaseOrThrow()
  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password,
  })

  if (error) throw error
  return data
}

export async function signOut() {
  const sb = getSupabaseOrThrow()
  const { error } = await sb.auth.signOut()
  if (error) throw error
}

export async function enrollTotp(friendlyName = 'BS Climbing Admin') {
  const sb = getSupabaseOrThrow()
  const { data, error } = await sb.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  })

  if (error) throw error
  if (!data?.id || !data.totp?.qr_code || !data.totp?.secret || !data.totp?.uri) {
    throw new Error('Kunne ikke starte TOTP-oppsett.')
  }

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  }
}

export async function challengeAndVerifyTotp(factorId: string, code: string) {
  const sb = getSupabaseOrThrow()
  const { data, error } = await sb.auth.mfa.challengeAndVerify({
    factorId,
    code,
  })

  if (error) throw error
  return data
}
