/**
 * Constant-time string comparison using crypto.subtle.timingSafeEqual.
 *
 * Prevents timing side-channel attacks when comparing secrets (API keys,
 * HMAC tokens, etc.).
 */

const encoder = new TextEncoder();

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  if (bufA.byteLength !== bufB.byteLength) {
    // Perform a dummy comparison to avoid leaking the length difference
    // via early-return timing, then return false.
    crypto.subtle.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.subtle.timingSafeEqual(bufA, bufB);
}
