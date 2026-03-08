import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side image proxy to bypass CORS restrictions.
 * Used by PDF generation to fetch images from Google Drive and other
 * external sources that block browser-side fetch().
 *
 * Usage: GET /api/image-proxy?url=<encoded-image-url>
 * Returns: The image as base64 data URL
 */

// Only these hostnames are permitted to be proxied.
const ALLOWED_HOSTNAMES = new Set([
  "lh3.googleusercontent.com",
  "drive.google.com",
  "res.cloudinary.com",
]);

// Max binary response size: 7 MB (fits in ~10 MB base64+JSON response)
const MAX_RESPONSE_BYTES = 7 * 1024 * 1024;

// Maximum number of redirects to follow before giving up.
const MAX_REDIRECTS = 3;

// Blocks RFC-1918 private ranges, loopback, and link-local addresses.
function isPrivateHost(hostname: string): boolean {
  const privatePatterns = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
  ];
  return privatePatterns.some((re) => re.test(hostname));
}

// Validates that a URL is safe to fetch: HTTPS, allowlisted hostname, non-private.
// Returns an error string on failure, or null on success.
function validateUrl(url: URL): string | null {
  if (url.protocol !== "https:") return "Only HTTPS URLs are allowed";
  if (!ALLOWED_HOSTNAMES.has(url.hostname)) return "URL hostname is not permitted";
  if (isPrivateHost(url.hostname)) return "URL hostname is not permitted";
  return null;
}

// Fetches a URL while manually following redirects so each hop can be
// validated against the allowlist (guarding against SSRF via open redirects).
async function safeFetch(url: URL): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current.toString(), {
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (response.status < 300 || response.status >= 400) {
      // Not a redirect — return whatever we got (ok or error).
      return response;
    }

    if (hop === MAX_REDIRECTS) {
      throw new Error("Too many redirects");
    }

    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect with no Location header");

    let next: URL;
    try {
      // Location may be relative; resolve against the current URL.
      next = new URL(location, current);
    } catch {
      throw new Error("Redirect to an invalid URL");
    }

    const err = validateUrl(next);
    if (err) throw new Error(`Redirect blocked: ${err}`);

    current = next;
  }
  // Unreachable, but satisfies TypeScript.
  throw new Error("Too many redirects");
}

export async function GET(request: NextRequest) {
  // Authentication: only signed-in users may use the proxy.
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawUrl = request.nextUrl.searchParams.get("url");

  if (!rawUrl) {
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 400 },
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json(
      { error: "Invalid url parameter" },
      { status: 400 },
    );
  }

  const validationError = validateUrl(parsed);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const response = await safeFetch(parsed);

    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${response.status}` },
        { status: 502 },
      );
    }

    // Enforce content-type is an image.
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json(
        { error: "Upstream did not return an image" },
        { status: 502 },
      );
    }

    // Reject early when the upstream advertises a size we'd refuse anyway.
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 502 });
    }

    // Stream the body so we can abort before fully buffering an oversized response.
    if (!response.body) {
      return NextResponse.json({ error: "No response body" }, { status: 502 });
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          return NextResponse.json(
            { error: "Image too large" },
            { status: 502 },
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.cancel();
    }

    const base64 = Buffer.concat(chunks).toString("base64");
    const dataUrl = `data:${contentType};base64,${base64}`;

    return NextResponse.json({ dataUrl });
  } catch (error) {
    console.error("Image proxy error:", error);
    return NextResponse.json(
      { error: "Failed to fetch image" },
      { status: 500 },
    );
  }
}
