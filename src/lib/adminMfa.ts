export type AuthenticatorAssuranceLevel = 'aal1' | 'aal2' | null

export type AdminMfaResolution =
  | 'loading'
  | 'signed_out'
  | 'forbidden'
  | 'setup'
  | 'verify'
  | 'allow'

export interface ResolveAdminMfaInput {
  loading: boolean
  hasUser: boolean
  isAdmin: boolean
  currentLevel: AuthenticatorAssuranceLevel
  nextLevel: AuthenticatorAssuranceLevel
  verifiedFactorCount: number
}

export function resolveAdminMfaState(input: ResolveAdminMfaInput): AdminMfaResolution {
  if (input.loading) return 'loading'
  if (!input.hasUser) return 'signed_out'
  if (!input.isAdmin) return 'forbidden'
  if (input.currentLevel === 'aal2') return 'allow'
  if (input.verifiedFactorCount > 0 && input.nextLevel === 'aal2') return 'verify'
  return 'setup'
}
