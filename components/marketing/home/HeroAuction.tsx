// components/marketing/home/HeroAuction.tsx - The hero's looping bidding war.
// Pure CSS (see the home section of app/globals.css): the marketing pages have a script
// budget, so there is no client component here. One 12 s cycle: four bids
// two seconds apart, the final bid, then SOLD with a confetti burst. Under
// reduced motion only the final, sold frame is shown. Fictional data.
import { Gavel, Timer } from "lucide-react";
import type { CSSProperties } from "react";

import { TeamChip } from "@/components/ds/team-chip";
import { Rupees } from "@/components/marketing/home/Rupees";
import { formatCurrency } from "@/lib/utils";

const HAWKS = { name: "Harbour Hawks", color: "#1d4ed8" };
const TITANS = { name: "Desert Titans", color: "#ea580c" };

/** Each bid: the price, the team leading after it, that team's purse left. */
const BIDS = [
  { amount: 2000000, team: HAWKS, purse: 6200000 },
  { amount: 2200000, team: TITANS, purse: 5400000 },
  { amount: 2400000, team: HAWKS, purse: 6200000 },
  { amount: 2600000, team: TITANS, purse: 5400000 },
  { amount: 2800000, team: HAWKS, purse: 6200000 },
];

const CONFETTI = ["#22d3ee", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#ffffff"];

/** Bids 0-3 show in their own 2 s window; the last one holds to the end. */
function stepClass(i: number) {
  return i === BIDS.length - 1 ? "hm-step-final" : "hm-step";
}
function stepStyle(i: number): CSSProperties | undefined {
  return i === BIDS.length - 1 ? undefined : { animationDelay: `${i * 2}s` };
}

export function HeroAuction() {
  return (
    <div aria-hidden className="relative">
      {/* Owner phones flanking the board: each glows on its own bids. */}
      <OwnerPhone team={HAWKS} bids={[0, 2, 4]} className="-top-24 -left-6 lg:-left-10" />
      <OwnerPhone team={TITANS} bids={[1, 3]} className="-right-3 -bottom-8 2xl:-right-8" />

      <div className="relative flex flex-col gap-5 overflow-hidden rounded-panel border border-line bg-surface/95 p-6 shadow-floating">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold tracking-widest text-signal uppercase">Set 1 · Marquee</span>
          <span className="inline-flex items-center gap-2 text-ink-muted">
            <span className="hm-live-dot size-2 rounded-full bg-unsold" /> Live
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-raised font-head text-2xl font-bold text-ink-muted ring-2 ring-signal/50">
            RM
          </span>
          <div>
            <p className="font-head text-4xl leading-none font-bold tracking-wide uppercase sm:text-5xl">Rohan Mehra</p>
            <p className="mt-1 text-ink-muted">All-Rounder · Base {formatCurrency(2000000)}</p>
          </div>
        </div>

        {/* Price: one per bid, stacked in the same grid cell. Plain text, not
            PriceTicker: five tickers are ~350 digit spans, doubled by the RSC
            payload, and that HTML weight cost the page its LCP budget. */}
        <div className="grid h-[1em] overflow-hidden font-head text-7xl leading-none font-bold tabular sm:text-8xl">
          {BIDS.map((b, i) => (
            <div key={b.amount} className={`${stepClass(i)} [grid-area:1/1]`} style={stepStyle(i)}>
              <Rupees text={formatCurrency(b.amount)} />
            </div>
          ))}
        </div>

        <div className="grid h-12 items-center">
          {BIDS.map((b, i) => (
            <div key={b.amount} className={`${stepClass(i)} [grid-area:1/1]`} style={stepStyle(i)}>
              <TeamChip name={b.team.name} color={b.team.color} leading />
            </div>
          ))}
        </div>

        {/* Bid timer: refills on every bid. */}
        <div className="flex items-center gap-2 text-timer">
          <Timer className="size-4 shrink-0" />
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
            <span className="hm-timer block h-full origin-left rounded-full bg-timer" />
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <HeroTile label="Leader's purse left" values={BIDS.map((b) => b.purse - b.amount)} />
          <HeroTile label="Next bid" values={BIDS.map((b) => b.amount + 200000)} className="text-signal" />
        </div>

        {/* SOLD moment */}
        <div className="hm-sold-wash pointer-events-none absolute inset-0 bg-sold/10" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="hm-sold flex items-center gap-3 rounded-card border-4 border-sold bg-canvas/90 px-8 py-3 font-head text-6xl font-bold tracking-widest text-sold uppercase shadow-floating sm:text-7xl">
            <Gavel className="size-12" /> Sold
          </span>
        </div>
        <div className="pointer-events-none absolute top-1/2 left-1/2">
          {Array.from({ length: 18 }, (_, i) => {
            const angle = (i / 18) * Math.PI * 2;
            const dist = 140 + (i % 3) * 50;
            return (
              <span
                key={i}
                className="hm-confetti absolute block h-3 w-1.5 rounded-sm"
                style={
                  {
                    backgroundColor: CONFETTI[i % CONFETTI.length],
                    "--x": `${Math.round(Math.cos(angle) * dist)}px`,
                    "--y": `${Math.round(Math.sin(angle) * dist * 0.8)}px`,
                    "--r": `${(i * 67) % 360}deg`,
                  } as CSSProperties
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** StatTile's look, with one label and a value per bid stacked under it. */
function HeroTile({ label, values, className }: { label: string; values: number[]; className?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
      <span className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{label}</span>
      <span className={`grid font-head text-4xl leading-none font-bold tabular ${className ?? "text-ink"}`}>
        {values.map((v, i) => (
          <span key={i} className={`${stepClass(i)} [grid-area:1/1]`} style={stepStyle(i)}>
            <Rupees text={formatCurrency(v)} />
          </span>
        ))}
      </span>
    </div>
  );
}

function OwnerPhone({
  team,
  bids,
  className,
}: {
  team: { name: string; color: string };
  bids: number[];
  className: string;
}) {
  return (
    <div
      className={`hm-float absolute z-10 hidden w-36 flex-col gap-2 rounded-[1.25rem] border-4 border-raised bg-canvas p-3 shadow-floating md:flex ${className}`}
    >
      <span className="flex items-center gap-1.5 text-[0.65rem] font-semibold tracking-wider text-ink-muted uppercase">
        <span className="size-2 rounded-full" style={{ backgroundColor: team.color }} />
        {team.name}
      </span>
      <span className="relative grid">
        <span
          className="rounded-control py-2 text-center text-sm font-bold text-white"
          style={{ backgroundColor: team.color }}
        >
          Raise +₹2L
        </span>
        {bids.map((i) => (
          <span
            key={i}
            className={`${i === BIDS.length - 1 ? "hm-tap-final" : "hm-tap"} absolute inset-0 rounded-control ring-4 ring-signal`}
            style={i === BIDS.length - 1 ? undefined : { animationDelay: `${i * 2}s` }}
          />
        ))}
      </span>
    </div>
  );
}
