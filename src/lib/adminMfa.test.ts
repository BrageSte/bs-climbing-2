import { describe, expect, it } from 'vitest'
import { resolveAdminMfaState } from './adminMfa'

describe('resolveAdminMfaState', () => {
  it('returns loading while auth state is unresolved', () => {
    expect(
      resolveAdminMfaState({
        loading: true,
        hasUser: false,
        isAdmin: false,
        currentLevel: null,
        nextLevel: null,
        verifiedFactorCount: 0,
      })
    ).toBe('loading')
  })

  it('requires setup when admin lacks verified factors', () => {
    expect(
      resolveAdminMfaState({
        loading: false,
        hasUser: true,
        isAdmin: true,
        currentLevel: 'aal1',
        nextLevel: 'aal1',
        verifiedFactorCount: 0,
      })
    ).toBe('setup')
  })

  it('requires verify when admin has a verified factor but not aal2 yet', () => {
    expect(
      resolveAdminMfaState({
        loading: false,
        hasUser: true,
        isAdmin: true,
        currentLevel: 'aal1',
        nextLevel: 'aal2',
        verifiedFactorCount: 1,
      })
    ).toBe('verify')
  })

  it('allows access when admin already has aal2', () => {
    expect(
      resolveAdminMfaState({
        loading: false,
        hasUser: true,
        isAdmin: true,
        currentLevel: 'aal2',
        nextLevel: 'aal2',
        verifiedFactorCount: 1,
      })
    ).toBe('allow')
  })
})
