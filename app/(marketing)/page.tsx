import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ClipboardList,
  Crown,
  Layers,
  Lightbulb,
  ListChecks,
  MonitorPlay,
  PartyPopper,
  Scale,
  Share2,
  ShieldCheck,
  Shuffle,
  Smartphone,
  Timer,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

import { buttonVariants } from "@/components/ds/button";
import { TeamChip } from "@/components/ds/team-chip";
import { CtaBand } from "@/components/marketing/CtaBand";
import { JsonLd } from "@/components/marketing/JsonLd";
import { Screenshot } from "@/components/marketing/Screenshot";
import { HeroAuction } from "@/components/marketing/home/HeroAuction";
import { LifeOfABid } from "@/components/marketing/home/LifeOfABid";
import { Rupees } from "@/components/marketing/home/Rupees";
import { formatRupees } from "@/convex/bidRules";
import { PLAN_ORDER, PLAN_TIERS } from "@/convex/planTiers";
import { FAQS, FEATURES, HOW_IT_WORKS } from "@/lib/marketing/content";
import { organizationJsonLd, softwareApplicationJsonLd, websiteJsonLd } from "@/lib/seo/jsonld";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "Bid11Pro - Cricket Auction Software for IPL-Style Player Auctions" },
  description:
    "Cricket auction software for local tournaments: owners bid live from their phones, purses are checked on the server, and the room watches on a projector.",
  alternates: { canonical: "/" },
};

/** An icon for each feature in FEATURES, by title. */
const FEATURE_ICONS: Record<string, LucideIcon> = {
  "Owners bid from their phones": Smartphone,
  "Purses checked on the server": ShieldCheck,
  "Categories, sets and increments": Layers,
  "Squad rules": ListChecks,
  "A visible bid timer": Timer,
  "Projector view and broadcast overlay": MonitorPlay,
  "Player import and registration": ClipboardList,
  "Results you can share": Share2,
  "Staff roles": Users,
  "Totals that add up": Scale,
  "Group draw": Shuffle,
  "Squad insights for owners": Lightbulb,
};

const TICKER = [
  "Live bidding from phones",
  "Purses checked on every bid",
  "Projector view",
  "OBS / vMix overlay",
  "Squad rules",
  "Bid timer",
  "Player registration",
  "Online entry fees",
  "Excel export",
  "Squad PDFs",
  "Group draw",
  "Public results page",
];

const AUDIENCES: { icon: LucideIcon; who: string; title: string; points: string[]; accent: string }[] = [
  {
    icon: Crown,
    who: "Organisers",
    title: "Run the whole show",
    accent: "from-signal/25",
    points: [
      "Set purses, squad size, categories and increments",
      "Import players or open a registration form with an entry fee",
      "Add co-organisers, auctioneers and registrars",
      "Run the auction from one console and share the results",
    ],
  },
  {
    icon: Smartphone,
    who: "Team owners",
    title: "Bid from your phone",
    accent: "from-[#1d4ed8]/30",
    points: [
      "Join with an invite link, no fuss",
      "See your purse, your squad and the player on the block live",
      "Raise with one tap, when the organiser allows it",
      "Get notes on your squad's gaps and a squad PDF",
    ],
  },
  {
    icon: PartyPopper,
    who: "Players & fans",
    title: "Watch every bid",
    accent: "from-sold/25",
    points: [
      "Register online for the tournament",
      "Follow the auction on the projector, a phone or the live stream",
      "See who went where on the public results page",
      "Share squads straight to WhatsApp",
    ],
  },
];

const BID_MODES = [
  { title: "Auctioneer bids", body: "Owners call it out in the room; the auctioneer enters every bid." },
  { title: "Owners raise, auctioneer confirms", body: "Owners tap raise on their phones; each raise waits for a nod." },
  { title: "Owners raise directly", body: "Owners bid live from their phones. The fastest finger leads." },
];

const FACTS = [
  { value: "₹0", label: "to start, no card" },
  { value: "3", label: "ways to take bids" },
  { value: "20", label: "teams on Pro" },
  { value: "500", label: "players on Pro" },
];

function SectionHead({ id, kicker, title, lead }: { id: string; kicker: string; title: string; lead?: string }) {
  return (
    <div className="hm-reveal flex flex-col gap-3 pb-10">
      <p className="text-sm font-semibold tracking-widest text-signal uppercase">{kicker}</p>
      <h2 id={id} className="font-head text-4xl font-bold tracking-wide uppercase sm:text-5xl">
        {title}
      </h2>
      {lead && <p className="max-w-2xl text-ink-muted">{lead}</p>}
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <JsonLd data={[organizationJsonLd(), websiteJsonLd(), softwareApplicationJsonLd()]} />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="fl-turf relative overflow-hidden border-b border-line">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 left-1/2 h-96 w-[60rem] -translate-x-1/2 rounded-full bg-signal/10 blur-3xl" />
          <div className="hm-beam absolute -top-20 left-[12%] h-[40rem] w-64 bg-[radial-gradient(ellipse_at_top,rgb(255_255_255/0.09),transparent_70%)]" />
          <div className="hm-beam absolute -top-20 right-[12%] h-[40rem] w-64 bg-[radial-gradient(ellipse_at_top,rgb(255_255_255/0.09),transparent_70%)] [animation-delay:-4.5s]" />
        </div>
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div className="flex flex-col gap-6">
            <p className="inline-flex items-center gap-2 self-start rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-sm font-semibold tracking-widest text-signal uppercase">
              <span className="hm-live-dot size-2 rounded-full bg-unsold" /> Cricket auction software
            </p>
            <h1 className="font-head text-6xl leading-[0.92] font-bold tracking-wide uppercase sm:text-7xl lg:text-8xl">
              Run your player auction <span className="hm-gradient-text">like the IPL</span>
            </h1>
            <p className="max-w-xl text-lg text-ink-muted sm:text-xl">
              Bid11Pro runs your tournament&apos;s player auction from start to finish. Players register, owners bid
              live from their phones, every purse is checked on the server, and the whole room watches the price climb
              on the projector.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/sign-up" className={buttonVariants({ size: "lg" })}>
                Start free <ArrowRight />
              </Link>
              <Link href="#how" className={buttonVariants({ size: "lg", variant: "secondary" })}>
                See how it works
              </Link>
            </div>
            <dl className="grid max-w-lg grid-cols-2 gap-x-6 gap-y-3 pt-2 sm:grid-cols-4">
              {FACTS.map((f) => (
                <div key={f.label} className="flex flex-col">
                  <dt className="order-2 text-xs text-ink-muted">{f.label}</dt>
                  <dd className="order-1 font-head text-3xl font-bold text-ink tabular">
                    {f.value.startsWith("₹") ? <Rupees text={f.value} /> : f.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <HeroAuction />
        </div>
      </section>

      {/* ── Ticker ───────────────────────────────────────────────────── */}
      <div className="hm-marquee-wrap overflow-hidden border-b border-line bg-signal py-3 text-signal-ink">
        <div className="hm-marquee flex w-max">
          {[0, 1].map((copy) => (
            <ul key={copy} aria-hidden={copy === 1} className="flex shrink-0 items-center">
              {TICKER.map((t) => (
                <li key={t} className="flex items-center gap-6 pr-6 font-head text-xl font-bold tracking-wider uppercase">
                  {t} <span aria-hidden>●</span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>

      {/* ── Who it's for ─────────────────────────────────────────────── */}
      <section aria-labelledby="who-h" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHead
          id="who-h"
          kicker="What is Bid11Pro?"
          title="One app for everyone in the room"
          lead="An IPL-style auction has a lot of moving parts. Bid11Pro gives each person exactly the screen they need."
        />
        <ul className="grid gap-5 md:grid-cols-3">
          {AUDIENCES.map((a) => (
            <li
              key={a.who}
              className={cn(
                "hm-reveal hm-card relative flex flex-col gap-4 overflow-hidden rounded-panel border border-line bg-linear-to-b to-surface to-60% p-7",
                a.accent,
              )}
            >
              <span className="flex size-14 items-center justify-center rounded-card bg-canvas/60 text-signal ring-1 ring-line">
                <a.icon className="size-7" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold tracking-widest text-ink-muted uppercase">{a.who}</p>
                <h3 className="font-head text-3xl font-bold tracking-wide uppercase">{a.title}</h3>
              </div>
              <ul className="flex flex-col gap-2.5">
                {a.points.map((p) => (
                  <li key={p} className="flex gap-2 text-ink-muted">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-signal" />
                    {p}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Life of a bid ────────────────────────────────────────────── */}
      <LifeOfABid />

      {/* ── All features ─────────────────────────────────────────────── */}
      <section aria-labelledby="features-h" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHead
          id="features-h"
          kicker="Features"
          title="Everything for auction night"
          lead="From the first registration to the final squad sheet. Every plan includes every feature."
        />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = FEATURE_ICONS[f.title] ?? Trophy;
            return (
              <li
                key={f.title}
                className="hm-reveal hm-card group flex flex-col gap-3 rounded-card border border-line bg-surface p-6"
              >
                <span className="flex size-11 items-center justify-center rounded-control bg-signal/10 text-signal transition-transform duration-(--dur-base) group-hover:scale-110 group-hover:-rotate-6">
                  <Icon className="size-6" aria-hidden />
                </span>
                <h3 className="text-lg font-semibold">{f.title}</h3>
                <p className="text-ink-muted">{f.body}</p>
              </li>
            );
          })}
        </ul>
        <Link href="/features" className={buttonVariants({ variant: "link", className: "mt-6 px-0" })}>
          More on every feature <ArrowRight />
        </Link>
      </section>

      {/* ── Your rules: bid modes + group draw ───────────────────────── */}
      <section aria-labelledby="rules-h" className="border-y border-line bg-surface/40">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <SectionHead
              id="rules-h"
              kicker="Your auction, your rules"
              title="Pick how bids come in"
              lead="Small club night or a packed hall with a live stream, choose the style that suits your room. Change it per tournament."
            />
            <ol className="flex flex-col gap-3">
              {BID_MODES.map((m, i) => (
                <li key={m.title} className="hm-reveal hm-card flex gap-4 rounded-card border border-line bg-surface p-5">
                  <span className="font-head text-4xl leading-none font-bold text-signal tabular">{i + 1}</span>
                  <div>
                    <h3 className="font-semibold">{m.title}</h3>
                    <p className="text-sm text-ink-muted">{m.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="hm-reveal flex flex-col gap-5 self-center rounded-panel border border-line bg-canvas p-6 shadow-floating">
            <div className="flex items-center justify-between">
              <h3 className="font-head text-3xl font-bold tracking-wide uppercase">After the hammer: group draw</h3>
              <Shuffle className="size-7 text-signal" aria-hidden />
            </div>
            <p className="text-ink-muted">
              Squads done? Draw the teams into groups with an animated reveal on the big screen.
            </p>
            <div aria-hidden className="grid grid-cols-2 gap-4">
              {[
                { name: "Group A", teams: [["Harbour Hawks", "#1d4ed8"], ["Coastal Kings", "#0f766e"]] },
                { name: "Group B", teams: [["Desert Titans", "#ea580c"], ["Royal Strikers", "#7c3aed"]] },
              ].map((g, gi) => (
                <div key={g.name} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
                  <span className="text-xs font-semibold tracking-widest text-signal uppercase">{g.name}</span>
                  {g.teams.map(([name, color], ti) => (
                    <div key={name} className="hm-shuffle" style={{ animationDelay: `${(ti * 2 + gi) * 0.35}s` }}>
                      <TeamChip name={name} color={color} className="w-full" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Screens ──────────────────────────────────────────────────── */}
      <section aria-labelledby="screen-h" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHead
          id="screen-h"
          kicker="Every screen covered"
          title="Big enough for the back row"
          lead="Put the auction on the venue projector, follow along on phones and add a broadcast overlay to your stream. These are real screens from a demo tournament."
        />
        <div className="grid items-start gap-8 lg:grid-cols-3">
          <Screenshot name="projector" className="hm-reveal lg:col-span-2" />
          <Screenshot name="viewerPhone" className="hm-reveal" />
          <Screenshot name="registrationPhone" className="hm-reveal" />
          <div className="flex flex-col gap-8 lg:col-span-2">
            <Screenshot name="overlay" className="hm-reveal" sizes="(min-width: 1280px) 800px, 100vw" />
            <Screenshot name="results" className="hm-reveal" sizes="(min-width: 1280px) 800px, 100vw" />
          </div>
        </div>
        <p className="mt-6 text-ink-muted">
          Streaming on YouTube? See the{" "}
          <Link href="/broadcast" className="text-signal hover:underline">
            broadcast overlay guide
          </Link>
          .
        </p>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section id="how" aria-labelledby="steps-h" className="scroll-mt-20 border-y border-line bg-surface/40">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <SectionHead id="steps-h" kicker="How it works" title="Five steps to auction night" />
          <ol className="relative grid gap-6 md:grid-cols-5">
            <span
              aria-hidden
              className="absolute top-7 right-[10%] left-[10%] hidden h-0.5 bg-linear-to-r from-signal/0 via-signal/60 to-signal/0 md:block"
            />
            {HOW_IT_WORKS.map((s, i) => (
              <li key={s.title} className="hm-reveal relative flex flex-col items-start gap-3 md:items-center md:text-center">
                <span className="relative z-10 flex size-14 items-center justify-center rounded-full border-2 border-signal bg-canvas font-head text-3xl font-bold text-signal tabular shadow-glow">
                  {i + 1}
                </span>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="text-sm text-ink-muted">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-10 text-ink-muted">
            Want the details? Read{" "}
            <Link href="/how-it-works" className="text-signal hover:underline">
              how it works
            </Link>{" "}
            or the{" "}
            <Link href="/for-organisers" className="text-signal hover:underline">
              organiser guide
            </Link>
            .
          </p>
        </div>
      </section>

      {/* ── Pricing teaser ───────────────────────────────────────────── */}
      <section aria-labelledby="price-h" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHead
          id="price-h"
          kicker="Pricing"
          title="Pay per tournament, not per month"
          lead="Start free. Upgrade only when you need more teams or players, and pay just the difference."
        />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_ORDER.map((tier) => {
            const plan = PLAN_TIERS[tier];
            return (
              <li
                key={tier}
                className={cn(
                  "hm-reveal hm-card flex flex-col gap-2 rounded-card border bg-surface p-6",
                  tier === "free" ? "border-signal" : "border-line",
                )}
              >
                <h3 className="font-head text-2xl font-bold tracking-wide uppercase">{plan.label}</h3>
                <p className="font-head text-4xl font-bold tabular">
                  <Rupees text={formatRupees(plan.price)} />
                </p>
                <p className="text-sm text-ink-muted">
                  {plan.maxTeams} teams · {plan.maxPlayers} players
                </p>
              </li>
            );
          })}
        </ul>
        <Link href="/pricing" className={buttonVariants({ variant: "link", className: "mt-6 px-0" })}>
          Compare plans <ArrowRight />
        </Link>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="faq-h" className="mx-auto max-w-4xl px-4 pb-8 sm:px-6">
        <SectionHead id="faq-h" kicker="Questions" title="Good to know" />
        <div className="flex flex-col gap-3">
          {FAQS.slice(0, 5).map((f) => (
            <details key={f.question} className="group rounded-card border border-line bg-surface open:border-signal/50">
              <summary className="fl-focus flex cursor-pointer list-none items-center justify-between gap-4 rounded-card p-5 font-semibold [&::-webkit-details-marker]:hidden">
                {f.question}
                <span
                  aria-hidden
                  className="text-2xl leading-none text-signal transition-transform duration-(--dur-base) group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="px-5 pb-5 text-ink-muted">{f.answer}</p>
            </details>
          ))}
        </div>
        <Link href="/faq" className={buttonVariants({ variant: "link", className: "mt-6 px-0" })}>
          All questions <ArrowRight />
        </Link>
      </section>

      <CtaBand />
    </>
  );
}
