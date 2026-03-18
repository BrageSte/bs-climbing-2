import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { challengeAndVerifyTotp, enrollTotp, signOut, useAdminAccess } from '@/hooks/useAdmin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Enrollment = {
  factorId: string
  qrCode: string
  secret: string
}

function getReturnTo(searchParams: URLSearchParams) {
  const returnTo = searchParams.get('returnTo')?.trim()
  if (!returnTo || !returnTo.startsWith('/admin')) return '/admin'
  return returnTo
}

export default function AdminMfaSetup() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = getReturnTo(searchParams)
  const { loading, resolution, refetch } = useAdminAccess()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPreparing, setIsPreparing] = useState(false)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const hasStartedRef = useRef(false)

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

    if (resolution === 'allow') {
      navigate(returnTo, { replace: true })
      return
    }

    if (resolution === 'verify') {
      navigate(`/admin/mfa/verify?returnTo=${encodeURIComponent(returnTo)}`, { replace: true })
    }
  }, [loading, navigate, resolution, returnTo])

  useEffect(() => {
    if (loading || resolution !== 'setup' || enrollment || hasStartedRef.current) return

    hasStartedRef.current = true
    setIsPreparing(true)
    setError('')

    void enrollTotp()
      .then((data) => {
        setEnrollment({
          factorId: data.factorId,
          qrCode: data.qrCode,
          secret: data.secret,
        })
      })
      .catch(() => {
        setError('Kunne ikke starte TOTP-oppsettet. Logg ut og prøv igjen.')
        hasStartedRef.current = false
      })
      .finally(() => {
        setIsPreparing(false)
      })
  }, [enrollment, loading, resolution])

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!enrollment) return

    const normalizedCode = code.trim().replace(/\s+/g, '')
    if (normalizedCode.length !== 6) {
      setError('Skriv inn den 6-sifrede koden fra autentiseringsappen.')
      return
    }

    setIsSubmitting(true)
    setError('')

    try {
      await challengeAndVerifyTotp(enrollment.factorId, normalizedCode)
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
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <ShieldCheck className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Sett opp TOTP for admin</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Admin-tilgang krever en ekstra bekreftelse. Skann QR-koden i autentiseringsappen din og skriv inn koden.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
          {isPreparing ? (
            <div className="flex items-center justify-center gap-3 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Forbereder TOTP-oppsett...
            </div>
          ) : null}

          {enrollment ? (
            <>
              <div className="rounded-xl border border-border bg-background p-4">
                <img
                  src={enrollment.qrCode}
                  alt="QR-kode for TOTP-oppsett"
                  className="mx-auto h-52 w-52 rounded-lg bg-white p-3"
                />
              </div>

              <div className="space-y-2">
                <Label>Manuell nøkkel</Label>
                <div className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm break-all">
                  {enrollment.secret}
                </div>
              </div>
            </>
          ) : null}

          <form onSubmit={handleVerify} className="space-y-4">
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
                  disabled={!enrollment || isPreparing || isSubmitting}
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <div className="flex gap-3">
              <Button type="submit" className="flex-1" disabled={!enrollment || isPreparing || isSubmitting}>
                {isSubmitting ? 'Bekrefter...' : 'Aktiver admin-MFA'}
              </Button>
              <Button type="button" variant="outline" onClick={handleSignOut} disabled={isSubmitting}>
                Logg ut
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
