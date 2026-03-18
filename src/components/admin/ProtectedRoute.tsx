import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { useAdminAccess } from '@/hooks/useAdmin'

interface ProtectedRouteProps {
  children: ReactNode
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const location = useLocation()
  const { isAdmin, loading, user, resolution, error } = useAdminAccess()
  const returnTo = encodeURIComponent(`${location.pathname}${location.search}`)

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Laster...</div>
      </div>
    )
  }

  // Not logged in
  if (!user) {
    return <Navigate to="/admin/login" replace />
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Sikkerhetsfeil</h1>
          <p className="text-muted-foreground mb-4">Kunne ikke verifisere admin-sikkerhet. Logg inn pa nytt og prov igjen.</p>
          <a href="/admin/login" className="text-primary hover:underline">Tilbake til innlogging</a>
        </div>
      </div>
    )
  }

  // Logged in but not admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Ingen tilgang</h1>
          <p className="text-muted-foreground mb-4">Du har ikke tilgang til admin-panelet.</p>
          <a href="/" className="text-primary hover:underline">Tilbake til forsiden</a>
        </div>
      </div>
    )
  }

  if (resolution === 'setup') {
    return <Navigate to={`/admin/mfa/setup?returnTo=${returnTo}`} replace />
  }

  if (resolution === 'verify') {
    return <Navigate to={`/admin/mfa/verify?returnTo=${returnTo}`} replace />
  }

  return <>{children}</>
}
