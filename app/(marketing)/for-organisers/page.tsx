import type { Metadata } from "next";
import Link from "next/link";

import { CtaBand } from "@/components/marketing/CtaBand";
import { PageIntro } from "@/components/marketing/PageIntro";
import { Screenshot } from "@/components/marketing/Screenshot";

export const metadata: Metadata = {
  title: "For Organisers: Player Auction for Your Local Tournament",
  description:
    "Running a local cricket league? Bid11Pro handles purses, squad rules, owner invites, player registration and results, so auction night runs on time.",
  alternates: { canonical: "/for-organisers" },
};

const POINTS = [
  {
    title: "Fair to every team",
    body: "Purses, squad sizes and the money each team must keep back are checked on the server for every bid, so no team can bid itself into a corner and nobody argues about the totals afterwards.",
  },
  {
    title: "Your rules, not ours",
    body: "Set categories with their own base prices, bid increments that step up with the price, and minimum or maximum players per role or category.",
  },
  {
    title: "Owners in the loop",
    body: "Invite each team owner by link. They follow the auction on their phone and, if you allow it, raise from there, with you confirming each raise or letting raises go straight through.",
  },
  {
    title: "Help on the night",
    body: "Add co-organisers and auctioneers to the tournament. Each person only sees the tournaments they work on.",
  },
  {
    title: "Less paperwork",
    body: "Players register through a public form, with an optional entry fee paid online. After the auction, share the results page and send each team its squad PDF.",
  },
];

export default function ForOrganisersPage() {
  return (
    <>
      <PageIntro
        path="/for-organisers"
        crumb="For organisers"
        title="Player auctions for local tournaments"
        lead="Built for the people who run box-cricket leagues, corporate tournaments and community cups, usually alongside a day job."
      />
      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_320px]">
        <ul className="flex flex-col gap-4">
          {POINTS.map((p) => (
            <li key={p.title} className="rounded-card border border-line bg-surface p-6">
              <h2 className="text-xl font-semibold">{p.title}</h2>
              <p className="mt-1 text-ink-muted">{p.body}</p>
            </li>
          ))}
        </ul>
        <Screenshot name="registrationPhone" />
      </section>
      <p className="mx-auto max-w-7xl px-4 text-ink-muted sm:px-6">
        See <Link href="/how-it-works" className="text-signal hover:underline">how it works</Link> and{" "}
        <Link href="/pricing" className="text-signal hover:underline">what it costs</Link>.
      </p>
      <CtaBand />
    </>
  );
}
