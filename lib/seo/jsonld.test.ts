import { describe, expect, test } from "vitest";
import { PLAN_ORDER, PLAN_TIERS } from "@/convex/planTiers";
import { FAQS, SITE_URL } from "@/lib/marketing/content";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  organizationJsonLd,
  serializeJsonLd,
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "./jsonld";

const isAbsolute = (url: unknown) =>
  typeof url === "string" && url.startsWith(`${SITE_URL}/`);

describe("JSON-LD shapes", () => {
  test.each([
    ["Organization", organizationJsonLd()],
    ["WebSite", websiteJsonLd()],
    ["SoftwareApplication", softwareApplicationJsonLd()],
    ["FAQPage", faqPageJsonLd()],
    ["BreadcrumbList", breadcrumbJsonLd([{ name: "Features", path: "/features" }])],
  ])("%s has the schema.org context and type", (type, data) => {
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe(type);
  });

  test("Organization and WebSite name the site with absolute URLs", () => {
    const org = organizationJsonLd();
    const site = websiteJsonLd();
    expect(org.name).toBe("Bid11Pro");
    expect(isAbsolute(org.url)).toBe(true);
    expect(isAbsolute(org.logo)).toBe(true);
    expect(site.publisher).toEqual({ "@id": org["@id"] });
  });

  test("SoftwareApplication has one INR offer per plan, priced from PLAN_TIERS", () => {
    const app = softwareApplicationJsonLd();
    expect(app.applicationCategory).toBeTruthy();
    expect(app.operatingSystem).toBeTruthy();
    const offers = app.offers as { "@type": string; price: string; priceCurrency: string; url: string }[];
    expect(offers).toHaveLength(PLAN_ORDER.length);
    offers.forEach((offer, i) => {
      expect(offer["@type"]).toBe("Offer");
      expect(offer.priceCurrency).toBe("INR");
      expect(Number(offer.price)).toBe(PLAN_TIERS[PLAN_ORDER[i]].price);
      expect(offer.url).toBe(`${SITE_URL}/pricing`);
    });
  });

  test("FAQPage mirrors the FAQ copy, question for question", () => {
    const entities = faqPageJsonLd().mainEntity as {
      "@type": string;
      name: string;
      acceptedAnswer: { "@type": string; text: string };
    }[];
    expect(entities).toHaveLength(FAQS.length);
    entities.forEach((q, i) => {
      expect(q["@type"]).toBe("Question");
      expect(q.name).toBe(FAQS[i].question);
      expect(q.acceptedAnswer["@type"]).toBe("Answer");
      expect(q.acceptedAnswer.text).toBe(FAQS[i].answer);
    });
  });

  test("BreadcrumbList starts at Home and numbers positions 1..n with absolute URLs", () => {
    const items = breadcrumbJsonLd([{ name: "Pricing", path: "/pricing" }]).itemListElement as {
      "@type": string;
      position: number;
      name: string;
      item: string;
    }[];
    expect(items.map((i) => i.position)).toEqual([1, 2]);
    expect(items[0]).toMatchObject({ "@type": "ListItem", name: "Home", item: `${SITE_URL}/` });
    expect(items[1].item).toBe(`${SITE_URL}/pricing`);
    items.forEach((i) => expect(isAbsolute(i.item)).toBe(true));
  });
});

describe("serializeJsonLd", () => {
  test("escapes < so copy can never close the script tag", () => {
    const out = serializeJsonLd(
      faqPageJsonLd([{ question: "</script><script>alert(1)</script>", answer: "a" }]),
    );
    expect(out).not.toContain("<");
    expect(JSON.parse(out).mainEntity[0].name).toBe("</script><script>alert(1)</script>");
  });
});
