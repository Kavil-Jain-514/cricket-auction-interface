// convex/razorpaySignature.ts - Razorpay webhook signature check. Pure Web
// Crypto (no Node APIs), so it runs in Convex HTTP actions.

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare (no early exit on the first difference). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * True when `signature` (the X-Razorpay-Signature header) is the hex
 * HMAC-SHA256 of the raw request body under the webhook secret.
 */
export async function verifyRazorpaySignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return safeEqual(expected, signature.trim().toLowerCase());
}
