import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";

import { CtaBand } from "@/components/marketing/CtaBand";
import { JsonLd } from "@/components/marketing/JsonLd";
import { PageIntro } from "@/components/marketing/PageIntro";
import { FAQS } from "@/lib/marketing/content";
import { faqPageJsonLd } from "@/lib/seo/jsonld";

export const metadata: Metadata = {
  title: "FAQ: Cricket Auction App Questions",
  description:
    "Answers about Bid11Pro: owner bidding from phones, purse checks, the bid timer, projector and stream overlay, player registration, results and pricing.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  return (
    <>
      <JsonLd data={faqPageJsonLd()} />
      <PageIntro
        path="/faq"
        crumb="FAQ"
        title="Questions organisers ask"
        lead="The short answers. If yours isn't here, the feature list and pricing pages go into more detail."
      />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        {/* Native <details>: keyboard and screen-reader friendly with no JavaScript. */}
        <div className="flex flex-col gap-3">
          {FAQS.map((f) => (
            <details key={f.question} className="group rounded-card border border-line bg-surface">
              <summary className="fl-focus flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-card px-5 py-3 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                <h2>{f.question}</h2>
                <ChevronDownIcon
                  aria-hidden
                  className="size-5 shrink-0 text-ink-muted transition-transform duration-(--dur-fast) group-open:rotate-180"
                />
              </summary>
              <p className="px-5 pb-5 text-ink-muted">{f.answer}</p>
            </details>
          ))}
        </div>
        <p className="mt-8 text-ink-muted">
          More on <Link href="/features" className="text-signal hover:underline">features</Link> and{" "}
          <Link href="/pricing" className="text-signal hover:underline">pricing</Link>.
        </p>
      </section>
      <CtaBand />
    </>
  );
}
