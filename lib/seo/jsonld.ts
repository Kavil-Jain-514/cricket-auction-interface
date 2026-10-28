// lib/seo/jsonld.ts - schema.org JSON-LD for the marketing pages.
// Pure builders: pages render them through components/marketing/JsonLd.tsx,
// and lib/seo/jsonld.test.ts checks their shape.

import { PLAN_ORDER, PLAN_TIERS } from "@/convex/planTiers";
import { FAQS, SITE_NAME, SITE_URL, type Faq } from "@/lib/marketing/content";

type JsonLdObject = { "@context": "https://schema.org"; "@type": string; [key: string]: unknown };

const CONTEXT = "https://schema.org" as const;

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

export function organizationJsonLd(): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: absoluteUrl("/"),
    logo: absoluteUrl("/icon.svg"),
  };
}

export function websiteJsonLd(): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: absoluteUrl("/"),
    inLanguage: "en-IN",
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

/** One Offer per plan tier, straight from PLAN_TIERS (prices in rupees). */
export function softwareApplicationJsonLd(): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    applicationCategory: "SportsApplication",
    operatingSystem: "Web browser",
    description:
      "Cricket auction software for running IPL-style player auctions for local tournaments.",
    publisher: { "@id": `${SITE_URL}/#organization` },
    offers: PLAN_ORDER.map((tier) => ({
      "@type": "Offer",
      name: `${PLAN_TIERS[tier].label} plan`,
      price: PLAN_TIERS[tier].price.toFixed(2),
      priceCurrency: "INR",
      url: absoluteUrl("/pricing"),
      description: `Per tournament: up to ${PLAN_TIERS[tier].maxTeams} teams and ${PLAN_TIERS[tier].maxPlayers} players.`,
    })),
  };
}

export function faqPageJsonLd(faqs: Faq[] = FAQS): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

/** Home is always the first crumb. */
export function breadcrumbJsonLd(trail: { name: string; path: string }[]): JsonLdObject {
  const items = [{ name: "Home", path: "/" }, ...trail];
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/** JSON for a <script type="application/ld+json">; escapes "<" so copy can't close the tag. */
export function serializeJsonLd(data: JsonLdObject | JsonLdObject[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
