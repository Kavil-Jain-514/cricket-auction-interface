import type { MetadataRoute } from "next";

import { MARKETING_PAGES } from "@/lib/marketing/content";
import { absoluteUrl } from "@/lib/seo/jsonld";

// Marketing pages only. Public results pages (/results/<id>) are indexable
// but not listed: there is no identity-free query listing completed
// tournaments yet, and this step changes no Convex functions.
export default function sitemap(): MetadataRoute.Sitemap {
  return MARKETING_PAGES.map((p) => ({
    url: absoluteUrl(p.path),
    changeFrequency: "monthly",
    priority: p.path === "/" ? 1 : 0.8,
  }));
}
