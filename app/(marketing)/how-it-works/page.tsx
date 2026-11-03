import type { Metadata } from "next";
import Link from "next/link";

import { CtaBand } from "@/components/marketing/CtaBand";
import { PageIntro } from "@/components/marketing/PageIntro";
import { Screenshot } from "@/components/marketing/Screenshot";
import { HOW_IT_WORKS } from "@/lib/marketing/content";

export const metadata: Metadata = {
  title: "How It Works: Run a Cricket Player Auction in Five Steps",
  description:
    "How to run a player auction for a local cricket tournament with Bid11Pro: set up, add teams and players, invite owners, run the auction and share the results.",
  alternates: { canonical: "/how-it-works" },
};

export default function HowItWorksPage() {
  return (
    <>
      <PageIntro
        path="/how-it-works"
        crumb="How it works"
        title="From sign-up to sold in five steps"
        lead="Set up the tournament ahead of time. On auction night, you run the room from one screen."
      />
      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <ol className="flex flex-col gap-4">
          {HOW_IT_WORKS.map((s, i) => (
            <li key={s.title} className="flex gap-5 rounded-card border border-line bg-surface p-6">
              <span className="font-head text-5xl leading-none font-bold text-signal tabular" aria-hidden>
                {i + 1}
              </span>
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold">{s.title}</h2>
                <p className="text-ink-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <Screenshot name="projector" />
        <p className="mt-6 text-ink-muted">
          Next: the full <Link href="/features" className="text-signal hover:underline">feature list</Link>, or the{" "}
          <Link href="/for-organisers" className="text-signal hover:underline">organiser guide</Link>.
        </p>
      </section>
      <CtaBand />
    </>
  );
}
