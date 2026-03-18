interface ParsedFunctionError {
  code?: string
  message: string
  retryAfterSeconds?: number
}

function parseRetryAfterSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.round(value)
}

function formatRetryAfter(seconds?: number) {
  if (!seconds) return 'litt'
  if (seconds < 60) return `${seconds} sekunder`

  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minutt${minutes === 1 ? '' : 'er'}`
}

export function toFriendlySecurityMessage(details: ParsedFunctionError): string {
  switch (details.code) {
    case 'RATE_LIMITED':
      return `Du har gjort for mange forespørsler. Prøv igjen om ${formatRetryAfter(details.retryAfterSeconds)}.`
    case 'REQUEST_TOO_LARGE':
      return 'Forespørselen var for stor. Oppdater siden og prøv igjen på nytt.'
    case 'SECURITY_CONFIG_MISSING':
      return 'Tjenesten mangler nødvendig sikkerhetsoppsett. Prøv igjen litt senere.'
    default:
      return details.message
  }
}

export async function readSupabaseFunctionError(invokeError: unknown): Promise<ParsedFunctionError> {
  const context = (invokeError as { context?: Response } | null)?.context
  if (context) {
    try {
      const bodyText = await context.text()
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText) as {
            error?: { code?: string; message?: string } | string
            code?: string
            retryAfterSeconds?: number
          }

          if (typeof parsed?.error === 'string') {
            return {
              code: parsed.code,
              message: parsed.error,
              retryAfterSeconds: parseRetryAfterSeconds(parsed.retryAfterSeconds),
            }
          }

          if (parsed?.error && typeof parsed.error === 'object') {
            return {
              code: parsed.error.code ?? parsed.code,
              message: parsed.error.message ?? 'Ukjent feil',
              retryAfterSeconds: parseRetryAfterSeconds(parsed.retryAfterSeconds),
            }
          }
        } catch {
          return { message: bodyText }
        }
      }
    } catch {
      // Ignore and fall through to default message.
    }
  }

  const message = invokeError instanceof Error ? invokeError.message : 'Ukjent feil'
  return { message }
}
