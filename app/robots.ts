import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/marketing/content";

// Private routes are NOT disallowed here: a crawler blocked by robots.txt
// never sees their X-Robots-Tag: noindex (next.config.ts) and may still list
// the bare URL. Only /api is off limits.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
