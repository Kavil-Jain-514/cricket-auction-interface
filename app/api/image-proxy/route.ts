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

// Max response size: 10 MB
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

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

export async function GET(request: NextRequest) {
  // Authentication: only signed-in users may use the proxy.
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawUrl = request.nextUrl.searchParams.get("url");

  if (!rawUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Invalid url parameter" }, { status: 400 });
  }

  // Only allow https.
  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Only HTTPS URLs are allowed" }, { status: 400 });
  }

  // Enforce domain allowlist.
  if (!ALLOWED_HOSTNAMES.has(parsed.hostname)) {
    return NextResponse.json(
      { error: "URL hostname is not permitted" },
      { status: 400 },
    );
  }

  // Block private/internal IP ranges (defence-in-depth).
  if (isPrivateHost(parsed.hostname)) {
    return NextResponse.json(
      { error: "URL hostname is not permitted" },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(parsed.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

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
          return NextResponse.json({ error: "Image too large" }, { status: 502 });
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
