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
    return NOINDEX_PATHS.map((source) => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    }));
  },
};

export default nextConfig;
