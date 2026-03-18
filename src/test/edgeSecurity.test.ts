import { describe, expect, it, vi } from 'vitest'
import {
  createRateLimitFingerprint,
  enforceRateLimit,
  normalizeRateLimitResult,
  readJsonBody,
} from '../../supabase/functions/_shared/security'

describe('edge security helpers', () => {
  it('creates deterministic fingerprints per route and ip', async () => {
    const first = await createRateLimitFingerprint('secret', 'create-checkout', '127.0.0.1')
    const second = await createRateLimitFingerprint('secret', 'create-checkout', '127.0.0.1')
    const third = await createRateLimitFingerprint('secret', 'verify-session', '127.0.0.1')

    expect(first).toBe(second)
    expect(first).not.toBe(third)
  })

  it('rejects oversized JSON bodies', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: JSON.stringify({ value: 'x'.repeat(40) }),
      headers: {
        'content-length': String(1024),
      },
    })

    const result = await readJsonBody(request, 16)
    expect('response' in result).toBe(true)

    if ('response' in result) {
      expect(result.response.status).toBe(413)
      await expect(result.response.json()).resolves.toMatchObject({
        error: { code: 'REQUEST_TOO_LARGE' },
      })
    }
  })

  it('normalizes table-returning RPC payloads', () => {
    expect(
      normalizeRateLimitResult([{ allowed: false, remaining: 0, retry_after_seconds: 42 }])
    ).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 42,
    })
  })

  it('returns a 429 response and writes an audit event when limited', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: false, remaining: 0, retry_after_seconds: 15 }],
      error: null,
    })

    const response = await enforceRateLimit({
      req: new Request('https://example.test', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '127.0.0.1',
        },
      }),
      supabaseAdmin: {
        rpc,
        from: () => ({ insert }),
      },
      rateLimitSecret: 'secret',
      route: 'create-checkout',
      limit: 6,
      windowSeconds: 600,
      auditEventType: 'checkout.rate_limited',
    })

    expect(response).not.toBeNull()
    expect(response?.status).toBe(429)
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED' },
      retryAfterSeconds: 15,
    })
    expect(rpc).toHaveBeenCalledOnce()
    expect(insert).toHaveBeenCalledOnce()
  })
})
