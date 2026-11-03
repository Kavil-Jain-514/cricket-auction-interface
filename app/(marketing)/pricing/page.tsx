import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { buttonVariants } from "@/components/ds/button";
import { CtaBand } from "@/components/marketing/CtaBand";
import { JsonLd } from "@/components/marketing/JsonLd";
import { PageIntro } from "@/components/marketing/PageIntro";
import { PLAN_ORDER, PLAN_TIERS } from "@/convex/planTiers";
import { softwareApplicationJsonLd } from "@/lib/seo/jsonld";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing: Free, Club, League and Pro Plans",
  description:
    "Bid11Pro pricing is per tournament. Start free with 4 teams and 60 players; upgrade to Club, League or Pro for bigger auctions.",
  alternates: { canonical: "/pricing" },
};

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default function PricingPage() {
  return (
    <>
      <JsonLd data={softwareApplicationJsonLd()} />
      <PageIntro
        path="/pricing"
        crumb="Pricing"
        title="Pay per tournament, not per month"
        lead="Every plan has every feature. You pay once for a tournament, and only for the number of teams and players you need. Upgrade at any time and pay the difference."
      />
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PLAN_ORDER.map((tier) => {
            const plan = PLAN_TIERS[tier];
            // Visual emphasis only; no popularity claim.
            const featured = tier === "league";
            return (
              <li
                key={tier}
                className={cn(
                  "flex flex-col gap-5 rounded-panel border bg-surface p-6",
                  featured ? "border-signal shadow-glow" : "border-line",
                )}
              >
                <h2 className="font-head text-3xl font-bold tracking-wide uppercase">{plan.label}</h2>
                <p>
                  <span className="font-head text-5xl font-bold tabular">{rupees(plan.price)}</span>
                  <span className="text-ink-muted"> / tournament</span>
                </p>
                <ul className="flex flex-col gap-2 text-ink">
                  {[`Up to ${plan.maxTeams} teams`, `Up to ${plan.maxPlayers} players`, "Every feature included"].map((line) => (
                    <li key={line} className="flex items-center gap-2">
                      <CheckIcon className="size-5 shrink-0 text-sold" aria-hidden />
                      {line}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/sign-up"
                  className={buttonVariants({ variant: featured ? "primary" : "secondary", className: "mt-auto" })}
                >
                  {plan.price === 0 ? "Start free" : `Choose ${plan.label}`}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mt-8 text-ink-muted">
          Prices in Indian rupees, paid online through Razorpay. Every tournament starts on Free; upgrade from the
          tournament page. Questions? See the <Link href="/faq" className="text-signal hover:underline">FAQ</Link>.
        </p>
      </section>
      <CtaBand />
    </>
  );
}
