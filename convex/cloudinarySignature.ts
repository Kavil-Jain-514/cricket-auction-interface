// convex/cloudinarySignature.ts - Cloudinary signed-upload signature (Web
// Crypto, so it runs in Convex actions). Lets an anonymous registrant upload
// a photo straight to Cloudinary without ever seeing the API secret.
// https://cloudinary.com/documentation/authentication_signatures

/** SHA-1 hex of the sorted "key=value&…" params with the secret appended. */
export async function cloudinarySignature(
  params: Record<string, string | number>,
  apiSecret: string,
): Promise<string> {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(toSign + apiSecret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
