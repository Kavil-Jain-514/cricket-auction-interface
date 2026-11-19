import type { NextConfig } from "next";

// Signed-in, live and one-off pages: keep them out of search results.
// Sent as a header (these pages are client components and can't export
// metadata). /results/* stays indexable.
const NOINDEX_PATHS = [
  "/auction/:path*",
  "/dashboard",
  "/tournament/:path*",
  "/admin",
  "/admin/:path*",
  "/join/:path*",
  "/register/:path*",
  "/design",
];

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
  async headers() {
    return [
      ...NOINDEX_PATHS.map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
      // Every page (AUDIT 2026-11 SEC-008).
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // No framing, so the console can't be clickjacked into a Sell or Next.
      // The broadcast overlay is left frameable for venue setups that embed it.
      {
        source: "/((?!auction/[^/]+/overlay).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
