import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { challengeAndVerifyTotp, signOut, useAdminAccess } from '@/hooks/useAdmin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function getReturnTo(searchParams: URLSearchParams) {
  const returnTo = searchParams.get('returnTo')?.trim()
  if (!returnTo || !returnTo.startsWith('/admin')) return '/admin'
  return returnTo
}

export default function AdminMfaVerify() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = getReturnTo(searchParams)
  const { loading, resolution, verifiedFactors, refetch } = useAdminAccess()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const primaryFactorId = useMemo(() => verifiedFactors[0]?.id ?? null, [verifiedFactors])

  useEffect(() => {
    if (loading) return

    if (resolution === 'signed_out') {
      navigate('/admin/login', { replace: true })
      return
    }

    if (resolution === 'forbidden') {
      navigate('/', { replace: true })
      return
    }

    if (resolution === 'setup') {
      navigate(`/admin/mfa/setup?returnTo=${encodeURIComponent(returnTo)}`, { replace: true })
      return
    }

    if (resolution === 'allow') {
      navigate(returnTo, { replace: true })
    }
  }, [loading, navigate, resolution, returnTo])

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!primaryFactorId) {
      setError('Fant ingen verifisert TOTP-faktor. Sett opp MFA på nytt.')
      return
    }

    const normalizedCode = code.trim().replace(/\s+/g, '')
    if (normalizedCode.length !== 6) {
      setError('Skriv inn den 6-sifrede koden fra autentiseringsappen.')
      return
    }

    setIsSubmitting(true)
    setError('')

    try {
      await challengeAndVerifyTotp(primaryFactorId, normalizedCode)
      await refetch()
      navigate(returnTo, { replace: true })
    } catch {
      setError('Ugyldig kode. Sjekk klokken på enheten og prøv igjen.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut()
    } finally {
      navigate('/admin/login', { replace: true })
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Laster admin-sikkerhet...
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <ShieldCheck className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Bekreft admin-tilgang</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Skriv inn den nåværende koden fra autentiseringsappen din for å åpne admin-panelet.
          </p>
        </div>

        <form onSubmit={handleVerify} className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="totp-code">6-sifret kode</Label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                className="pl-10 tracking-[0.35em]"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {error ? (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="flex gap-3">
            <Button type="submit" className="flex-1" disabled={isSubmitting}>
              {isSubmitting ? 'Bekrefter...' : 'Åpne admin'}
            </Button>
            <Button type="button" variant="outline" onClick={handleSignOut} disabled={isSubmitting}>
              Logg ut
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
