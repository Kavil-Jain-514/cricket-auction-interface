// components/marketing/CtaBand.tsx - Closing call to action on every page.
import Link from "next/link";

import { buttonVariants } from "@/components/ds/button";

export function CtaBand({ title = "Ready for auction night?" }: { title?: string }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
      <div className="flex flex-col items-start gap-6 rounded-panel border border-signal/40 bg-surface p-8 shadow-glow sm:flex-row sm:items-center sm:justify-between sm:p-12">
        <div className="flex flex-col gap-2">
          <h2 className="font-head text-4xl font-bold tracking-wide uppercase">{title}</h2>
          <p className="text-ink-muted">The Free plan covers 4 teams and 60 players. No card needed.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/sign-up" className={buttonVariants({ size: "lg" })}>
            Start free
          </Link>
          <Link href="/pricing" className={buttonVariants({ size: "lg", variant: "secondary" })}>
            See pricing
          </Link>
        </div>
      </div>
    </section>
  );
}
