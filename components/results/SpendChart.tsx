"use client";

import { TeamLogo } from '@/components/ui/team-logo';
import { formatCurrency } from '@/lib/utils';

interface SpendChartProps {
  teams: Array<{
    _id: string;
    name: string;
    logoUrl?: string;
    colorPrimary: string;
    purseSpent: number;
    purseRemaining: number;
    players: unknown[];
  }>;
  basePurse: number;
}

// Single series (spent), so one hue and no legend; the track is the purse.
// #3987e5 is the reference categorical slot 1 for dark surfaces, validated
// against slate-900 (dataviz validate_palette: all checks pass).
const BAR = '#3987e5';

/**
 * Horizontal bars of purse spent per team against the full purse, biggest
 * spender first. Identity is the label (logo + name), never the bar colour;
 * each bar carries its value as a direct label and a hover/focus tooltip.
 */
export function SpendChart({ teams, basePurse }: SpendChartProps) {
  const sorted = [...teams].sort((a, b) => b.purseSpent - a.purseSpent);
  const scale = Math.max(basePurse, ...teams.map((t) => t.purseSpent + t.purseRemaining), 1);

  return (
    <figure className="space-y-3" aria-labelledby="spend-chart-title">
      <figcaption id="spend-chart-title" className="text-sm text-slate-400">
        Purse spent per team, out of {formatCurrency(basePurse)}
      </figcaption>
      <ul className="space-y-2.5">
        {sorted.map((team) => {
          const pct = (team.purseSpent / scale) * 100;
          const label = `${team.name}: ${formatCurrency(team.purseSpent)} spent, ${formatCurrency(team.purseRemaining)} left, ${team.players.length} players`;
          return (
            <li key={team._id} className="group grid grid-cols-[minmax(0,9rem)_1fr] sm:grid-cols-[minmax(0,12rem)_1fr] items-center gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <TeamLogo name={team.name} logoUrl={team.logoUrl} primaryColor={team.colorPrimary} size="sm" />
                <span className="text-sm text-slate-200 truncate">{team.name}</span>
              </div>
              <div className="relative flex items-center gap-2" tabIndex={0} aria-label={label}>
                {/* Track = the whole purse; bar = spent, 4px rounded data end. */}
                <div className="relative h-3.5 flex-1 rounded-sm bg-slate-800">
                  <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${pct}%`, backgroundColor: BAR }} />
                </div>
                <span className="w-16 shrink-0 text-right text-sm tabular-nums text-slate-200">{formatCurrency(team.purseSpent)}</span>
                <div
                  role="tooltip"
                  className="pointer-events-none absolute -top-10 left-0 z-10 hidden whitespace-nowrap rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 shadow-lg group-hover:block group-focus-within:block"
                >
                  {formatCurrency(team.purseSpent)} spent · {formatCurrency(team.purseRemaining)} left · {team.players.length} players
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
