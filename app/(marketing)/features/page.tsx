import type { Metadata } from "next";
import Link from "next/link";

import { CtaBand } from "@/components/marketing/CtaBand";
import { PageIntro } from "@/components/marketing/PageIntro";
import { Screenshot } from "@/components/marketing/Screenshot";
import { FEATURES } from "@/lib/marketing/content";

export const metadata: Metadata = {
  title: "Features: Live Bidding, Purse Rules and Projector View",
  description:
    "What Bid11Pro does: owner bidding from phones, server-checked purses, categories and squad rules, a projector view, a broadcast overlay and shareable results.",
  alternates: { canonical: "/features" },
};

export default function FeaturesPage() {
  return (
    <>
      <PageIntro
        path="/features"
        crumb="Features"
        title="Every feature your auction needs"
        lead="From registration to the final squad sheet: the tools a local cricket league needs to run an IPL-style player auction."
      />
      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_320px]">
        <ul className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-6">
              <h2 className="text-lg font-semibold">{f.title}</h2>
              <p className="text-ink-muted">{f.body}</p>
            </li>
          ))}
        </ul>
        <aside className="flex flex-col gap-8">
          <Screenshot name="viewerPhone" />
          <Screenshot name="registrationPhone" />
        </aside>
      </section>
      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <Screenshot name="results" />
        <p className="mt-6 text-ink-muted">
          See the <Link href="/how-it-works" className="text-signal hover:underline">five steps</Link>, the{" "}
          <Link href="/broadcast" className="text-signal hover:underline">broadcast overlay</Link> and{" "}
          <Link href="/pricing" className="text-signal hover:underline">pricing</Link>.
        </p>
      </section>
      <CtaBand />
    </>
  );
}
