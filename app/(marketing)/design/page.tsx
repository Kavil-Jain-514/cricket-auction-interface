import type { Metadata } from "next";

import { PlayerCard, type PlayerCardData } from "@/components/ds/player-card";
import { PriceTicker } from "@/components/ds/price-ticker";
import { Skeleton } from "@/components/ds/skeleton";
import { StatTile } from "@/components/ds/stat-tile";
import { TeamChip } from "@/components/ds/team-chip";
import { ContrastTable, MotionDemo, PrimitivesDemo } from "@/components/marketing/DesignPlayground";
import { MOTION } from "@/lib/design/tokens";
import { formatCurrency } from "@/lib/utils";

// Review page for the floodlight system (step 20 PR a). Not for search.
export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

// Fictional demo data only.
const TEAMS = [
  { name: "Lakeside Lions", color: "#f5b301" },
  { name: "Harbour Hawks", color: "#1d4ed8" },
  { name: "Old Town Tigers", color: "#e11d48" },
  { name: "Riverside Royals", color: "#7c3aed" },
];

const LIVE: PlayerCardData = {
  name: "Rohan Mehra",
  roles: ["All-Rounder"],
  playerNumber: 27,
  category: "Marquee",
  basePrice: 2000000,
  status: "live",
};

const SOLD: PlayerCardData = {
  name: "Arjun Pillai",
  roles: ["Batter"],
  category: "A",
  basePrice: 1000000,
  status: "sold",
  soldPrice: 2400000,
  team: TEAMS[1],
};

const UNSOLD: PlayerCardData = {
  name: "Kabir Sethi",
  roles: ["Bowler"],
  category: "B",
  basePrice: 500000,
  status: "unsold",
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-6 border-t border-line py-12">
      <h2 id={id} className="font-head text-3xl font-bold tracking-wide uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DesignPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-4 pb-12">
        <p className="text-sm font-semibold tracking-widest text-signal uppercase">Step 20 · review</p>
        <h1 className="font-head text-5xl font-bold tracking-wide uppercase sm:text-7xl">Floodlight</h1>
        <p className="max-w-3xl text-lg text-ink-muted">
          A night match under stadium lights: a deep navy-black canvas, one electric cyan accent, and team colours as
          live accents. Open this page on your phone and on the venue projector before it is applied to the app
          screens.
        </p>
        <ul className="grid gap-3 text-ink-muted md:grid-cols-2">
          <li className="rounded-card border border-line bg-surface p-4">
            <strong className="text-ink">Why cyan, not lime.</strong> SOLD is green and must be the one moment
            nobody misreads. Lime sits next to that green; cyan stays clear of sold (green), unsold (red) and the
            timer (amber).
          </li>
          <li className="rounded-card border border-line bg-surface p-4">
            <strong className="text-ink">Type.</strong> Barlow Condensed for names and prices: condensed, so long
            names and big numbers fit a projector, with tabular figures so a rising bid never jitters. It has no ₹
            glyph, so ₹ is set in Inter, the UI face we keep.
          </li>
        </ul>
      </header>

      <Section id="colour" title="Colour">
        <p className="text-ink-muted">
          Ratios are measured live against <code>canvas</code> from the rendered CSS. Green passes WCAG 2.2 AA
          (4.5:1 text, 3:1 UI); the unit test checks every pair on every background.
        </p>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-panel bg-canvas p-4 ring-1 ring-line" data-theme="dark">
            <h3 className="font-semibold text-ink">Dark (default)</h3>
            <ContrastTable />
          </div>
          <div className="flex flex-col gap-3 rounded-panel bg-canvas p-4 text-ink ring-1 ring-line" data-theme="light">
            <h3 className="font-semibold text-ink">Light (daytime venues)</h3>
            <ContrastTable />
          </div>
        </div>
      </Section>

      <Section id="type" title="Type">
        <div className="flex flex-col gap-4">
          <p className="font-head text-7xl leading-none font-bold tracking-wide uppercase">Rohan Mehra</p>
          <p className="font-head text-5xl font-bold tracking-wide uppercase">Section heading</p>
          <p className="text-xl">Body large — Inter, for anything people read at length.</p>
          <p className="text-base text-ink-muted">Body — the default for UI text, labels and help.</p>
          <div className="flex flex-wrap items-end gap-8">
            <div>
              <p className="text-sm text-ink-muted">Tabular (fixed width)</p>
              <p className="font-head text-5xl font-bold tabular">
                ₹11.11L
                <br />
                ₹88.88L
              </p>
            </div>
            <div>
              <p className="text-sm text-ink-muted">Proportional (jitters)</p>
              <p className="font-head text-5xl font-bold [font-variant-numeric:proportional-nums]">
                ₹11.11L
                <br />
                ₹88.88L
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section id="motion" title="Motion">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {MOTION.map((m) => (
            <li key={m.name} className="rounded-card border border-line bg-surface p-4">
              <p className="font-mono text-sm text-signal">{m.name}</p>
              <p className="font-head text-3xl font-bold tabular">{m.ms} ms</p>
              <p className="text-sm text-ink-muted">{m.use}</p>
            </li>
          ))}
        </ul>
        <p className="text-ink-muted">
          One easing (expo-out). Everything here is instant under “reduce motion”. The auction page keeps its current
          timings until you approve changes.
        </p>
        <MotionDemo />
      </Section>

      <Section id="components" title="Components">
        <PrimitivesDemo />
        <div className="flex flex-wrap gap-3">
          {TEAMS.map((t, i) => (
            <TeamChip key={t.name} {...t} leading={i === 1} />
          ))}
          {TEAMS.slice(0, 2).map((t) => (
            <TeamChip key={`${t.name}-o`} {...t} variant="outline" />
          ))}
        </div>
        <PlayerCard player={LIVE} variant="hero" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <PlayerCard player={LIVE} />
          <PlayerCard player={SOLD} />
          <PlayerCard player={UNSOLD} />
          <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3">
            <Skeleton className="aspect-4/5 w-full" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        </div>
        <div className="rounded-card border border-line bg-surface p-2">
          <PlayerCard player={SOLD} variant="row" />
          <PlayerCard player={{ ...UNSOLD, status: "upcoming" }} variant="row" />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile label="Purse left" value={formatCurrency(4200000)} hint="of ₹1.00Cr" />
          <StatTile label="Sold" value="38" tone="sold" />
          <StatTile label="Unsold" value="6" tone="unsold" />
          <StatTile label="Timer" value="0:08" tone="timer" />
        </div>
      </Section>

      <Section id="projector" title="Projector, 15 m away">
        <p className="text-ink-muted">
          Full viewport height. Player name is 7vh and the price 14vh (minimums: 6vh and 10vh), so they read from the
          back of a hall.
        </p>
        <div className="fl-turf relative flex h-screen flex-col justify-center gap-[3vh] overflow-hidden rounded-panel border border-line bg-canvas px-[5vw]">
          <p className="text-[2.4vh] font-semibold tracking-widest text-signal uppercase">Set 2 · Marquee · Live</p>
          <p className="font-head text-[7vh] leading-none font-bold tracking-wide uppercase">{LIVE.name}</p>
          <PriceTicker amount={2400000} className="text-[14vh] text-ink" />
          <TeamChip {...TEAMS[1]} leading className="self-start text-[2.4vh]" />
        </div>
      </Section>

      <Section id="phone" title="Phone, 390 px">
        <div className="mx-auto flex w-full max-w-[390px] flex-col gap-4 rounded-[2.5rem] border-8 border-raised bg-canvas p-4">
          <PlayerCard player={LIVE} variant="hero" />
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-muted">Current bid</span>
            <PriceTicker amount={2400000} className="text-5xl text-ink" />
          </div>
          <TeamChip {...TEAMS[1]} leading />
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Purse left" value={formatCurrency(4200000)} />
            <StatTile label="Slots left" value="7" />
          </div>
        </div>
      </Section>
    </div>
  );
}
