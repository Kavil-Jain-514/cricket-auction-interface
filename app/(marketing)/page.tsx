import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buttonVariants } from "@/components/ds/button";
import { PriceTicker } from "@/components/ds/price-ticker";
import { StatTile } from "@/components/ds/stat-tile";
import { TeamChip } from "@/components/ds/team-chip";
import { CtaBand } from "@/components/marketing/CtaBand";
import { JsonLd } from "@/components/marketing/JsonLd";
import { Screenshot } from "@/components/marketing/Screenshot";
import { FEATURES, HOW_IT_WORKS } from "@/lib/marketing/content";
import { organizationJsonLd, softwareApplicationJsonLd, websiteJsonLd } from "@/lib/seo/jsonld";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "Bid11Pro - Cricket Auction Software for IPL-Style Player Auctions" },
  description:
    "Cricket auction software for local tournaments: owners bid live from their phones, purses are checked on the server, and the room watches on a projector.",
  alternates: { canonical: "/" },
};

/** The hero's "live board": real design-system components, fictional data. */
function LiveBoard() {
  return (
    <div
      aria-hidden
      className="relative flex flex-col gap-5 rounded-panel border border-line bg-surface/80 p-6 shadow-floating backdrop-blur"
    >
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold tracking-widest text-signal uppercase">Set 1 · Marquee</span>
        <span className="inline-flex items-center gap-2 text-ink-muted">
          <span className="size-2 rounded-full bg-sold" /> Live
        </span>
      </div>
      <div>
        <p className="font-head text-5xl leading-none font-bold tracking-wide uppercase sm:text-6xl">Rohan Mehra</p>
        <p className="mt-2 text-ink-muted">All-Rounder · Base {formatCurrency(2000000)}</p>
      </div>
      <PriceTicker amount={2400000} className="text-7xl text-ink sm:text-8xl" />
      <TeamChip name="Harbour Hawks" color="#1d4ed8" leading className="self-start" />
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Purse left" value={formatCurrency(4200000)} />
        <StatTile label="Next bid" value={formatCurrency(2600000)} tone="signal" />
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <JsonLd data={[organizationJsonLd(), websiteJsonLd(), softwareApplicationJsonLd()]} />

      <section className="fl-turf relative overflow-hidden border-b border-line">
        {/* Floodlight wash */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[60rem] -translate-x-1/2 rounded-full bg-signal/10 blur-3xl"
        />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div className="flex flex-col gap-6">
            <p className="text-sm font-semibold tracking-widest text-signal uppercase">Cricket auction software</p>
            <h1 className="font-head text-6xl leading-[0.92] font-bold tracking-wide uppercase sm:text-7xl lg:text-8xl">
              Run your player auction like the IPL
            </h1>
            <p className="max-w-xl text-lg text-ink-muted sm:text-xl">
              Owners bid live from their phones, every purse is checked on the server, and the whole room watches the
              price climb on the projector.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/sign-up" className={buttonVariants({ size: "lg" })}>
                Start free <ArrowRight />
              </Link>
              <Link href="/how-it-works" className={buttonVariants({ size: "lg", variant: "secondary" })}>
                How it works
              </Link>
            </div>
            <p className="text-sm text-ink-muted">Free for up to 4 teams and 60 players.</p>
          </div>
          <LiveBoard />
        </div>
      </section>

      <section aria-labelledby="features-h" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="flex flex-col gap-3 pb-10">
          <h2 id="features-h" className="font-head text-4xl font-bold tracking-wide uppercase sm:text-5xl">
            Built for auction night
          </h2>
          <p className="max-w-2xl text-ink-muted">
            Everything a local league needs to run a player auction, from the first registration to the final squad
            sheet.
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.slice(0, 6).map((f) => (
            <li key={f.title} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-6">
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="text-ink-muted">{f.body}</p>
            </li>
          ))}
        </ul>
        <Link href="/features" className={buttonVariants({ variant: "link", className: "mt-6 px-0" })}>
          All features <ArrowRight />
        </Link>
      </section>

      <section aria-labelledby="screen-h" className="border-y border-line bg-surface/50">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-20 sm:px-6">
          <div className="flex flex-col gap-3">
            <h2 id="screen-h" className="font-head text-4xl font-bold tracking-wide uppercase sm:text-5xl">
              Big enough for the back row
            </h2>
            <p className="max-w-2xl text-ink-muted">
              Put the auction page on the venue projector. Owners follow, or bid, on their phones. For a live stream,
              add the <Link href="/broadcast" className="text-signal hover:underline">broadcast overlay</Link>.
            </p>
          </div>
          <Screenshot name="projector" />
        </div>
      </section>

      <section aria-labelledby="steps-h" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <h2 id="steps-h" className="pb-10 font-head text-4xl font-bold tracking-wide uppercase sm:text-5xl">
          Five steps to auction night
        </h2>
        <ol className="grid gap-4 md:grid-cols-5">
          {HOW_IT_WORKS.map((s, i) => (
            <li key={s.title} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5">
              <span className="font-head text-4xl font-bold text-signal tabular">{i + 1}</span>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="text-sm text-ink-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-ink-muted">
          Running a league? Read the <Link href="/for-organisers" className="text-signal hover:underline">organiser guide</Link>{" "}
          or the <Link href="/faq" className="text-signal hover:underline">FAQ</Link>.
        </p>
      </section>

      <CtaBand />
    </>
  );
}
