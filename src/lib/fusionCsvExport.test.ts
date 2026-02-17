import { describe, expect, it } from 'vitest'
import {
  buildFusionCsvFilename,
  buildOrderConfirmationCode,
  toSafeSlug,
} from './fusionCsvExport'

describe('toSafeSlug', () => {
  it('normalizes Norwegian characters to safe ASCII', () => {
    expect(toSafeSlug('Bråten Ødegård')).toBe('braten-odegard')
  })

  it('handles email with special characters', () => {
    expect(toSafeSlug('ola+test@epost.no')).toBe('ola-test-at-epost-no')
  })

  it('falls back to ukjent for empty values', () => {
    expect(toSafeSlug('   ')).toBe('ukjent')
  })
})

describe('buildOrderConfirmationCode', () => {
  it('uses ORDER prefix and uppercased first 8 chars from order id', () => {
    expect(buildOrderConfirmationCode('a1b2c3d4-1234-5678-9abc-def012345678')).toBe('ORDERA1B2C3D4')
  })
})

describe('buildFusionCsvFilename', () => {
  it('builds the expected filename format', () => {
    expect(
      buildFusionCsvFilename(
        'Bråten Ødegård',
        'ola+test@epost.no',
        'BS-0002',
        'a1b2c3d4-1234-5678-9abc-def012345678'
      )
    ).toBe('braten-odegard-ola-test-at-epost-no_BS-0002_ORDERA1B2C3D4.csv')
  })
})
