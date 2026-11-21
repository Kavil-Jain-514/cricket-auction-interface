// components/marketing/home/LifeOfABid.tsx - One bid's path, animated in CSS:
// an owner taps on their phone, the server checks it, the projector shows it.
// A 6 s loop; each check ticks in turn. Static under reduced motion.
import { Check, MonitorPlay, Server, Smartphone } from "lucide-react";

import { formatCurrency } from "@/lib/utils";

const CHECKS = [
  "It's still this player and this price",
  "The purse covers the bid",
  "Enough is kept back to fill the squad",
  "Squad rules still hold",
];

function Stage({
  icon: Icon,
  step,
  title,
  children,
}: {
  icon: typeof Server;
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="relative z-10 flex flex-col gap-4 rounded-panel border border-line bg-surface p-6 shadow-raised">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-signal/15 text-signal">
          <Icon className="size-6" aria-hidden />
        </span>
        <div>
          <p className="text-xs font-semibold tracking-widest text-ink-muted uppercase">Step {step}</p>
          <h3 className="font-head text-2xl font-bold tracking-wide uppercase">{title}</h3>
        </div>
      </div>
      {children}
    </li>
  );
}

export function LifeOfABid() {
  return (
    <section aria-labelledby="bid-h" className="relative overflow-hidden border-y border-line bg-surface/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-20 sm:px-6">
        <div className="hm-reveal flex flex-col gap-3">
          <p className="text-sm font-semibold tracking-widest text-signal uppercase">Under the hood</p>
          <h2 id="bid-h" className="font-head text-4xl font-bold tracking-wide uppercase sm:text-5xl">
            The life of a bid, in under a second
          </h2>
          <p className="max-w-2xl text-ink-muted">
            Nobody has to trust a spreadsheet on auction night. Every bid is checked on the server before anyone sees
            it, so a team can&apos;t overspend and two people can&apos;t win the same raise.
          </p>
        </div>

        <ol className="relative grid gap-6 lg:grid-cols-3">
          {/* The wire between the stages, with a pulse running along it. */}
          <span aria-hidden className="absolute top-1/2 right-[16%] left-[16%] hidden h-0.5 bg-line lg:block">
            <span className="hm-pulse absolute -top-1 block size-2.5 rounded-full bg-signal shadow-glow" />
          </span>

          <Stage icon={Smartphone} step={1} title="Owner taps raise">
            <div className="flex flex-col gap-3 rounded-card border border-line bg-canvas p-4">
              <span className="text-sm text-ink-muted">Harbour Hawks · purse {formatCurrency(6200000)}</span>
              <span className="hm-press rounded-control bg-[#1d4ed8] py-3 text-center font-semibold text-white">
                Raise to {formatCurrency(2600000)}
              </span>
            </div>
            <p className="text-sm text-ink-muted">
              From their own phone, by invite link. Or the auctioneer bids for them from the console.
            </p>
          </Stage>

          <Stage icon={Server} step={2} title="Server checks it">
            <ul className="flex flex-col gap-2 rounded-card border border-line bg-canvas p-4">
              {CHECKS.map((c, i) => (
                <li key={c} className="flex items-center gap-2 text-sm">
                  <span
                    className="hm-check flex size-5 shrink-0 items-center justify-center rounded-full bg-sold text-canvas"
                    style={{ animationDelay: `${i * 0.25}s` }}
                  >
                    <Check className="size-3.5" strokeWidth={3} aria-hidden />
                  </span>
                  {c}
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink-muted">A bid that breaks a rule is refused with a clear reason.</p>
          </Stage>

          <Stage icon={MonitorPlay} step={3} title="The room sees it">
            <div className="flex flex-col items-center gap-1 rounded-card border border-line bg-canvas p-4">
              <span className="text-xs font-semibold tracking-widest text-ink-muted uppercase">Current bid</span>
              <span className="hm-flash font-head text-5xl font-bold tabular">{formatCurrency(2600000)}</span>
              <span className="text-sm font-semibold text-[#60a5fa]">Harbour Hawks lead</span>
            </div>
            <p className="text-sm text-ink-muted">
              Projector, every phone and the stream overlay update together, live.
            </p>
          </Stage>
        </ol>
      </div>
    </section>
  );
}
