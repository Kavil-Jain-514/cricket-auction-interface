"use client";

import Link from 'next/link';
import { useQuery } from 'convex/react';
import { Trophy, Crown } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { ImgWithFallback } from '@/components/ui/img-with-fallback';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { TeamLogo } from '@/components/ui/team-logo';
import { CategoryChip } from '@/components/players/CategoryChip';
import { formatCurrency, getRoleDisplay } from '@/lib/utils';
import { SpendChart } from './SpendChart';
import { bestValueBuy, roleBalance } from '@/lib/insights';
import type { SquadRule } from '@/convex/squadRules';

const ROLE_SHORT: Record<string, string> = { Batter: 'BAT', Bowler: 'BOWL', 'All-Rounder': 'AR', 'Wicket Keeper': 'WK' };

/** Role balance (with any squad minimums) and the best-value buy for one team. */
function SquadSummary({
  players,
  squadRules,
}: {
  players: Array<{ name: string; role: string | string[]; soldPrice: number; basePrice: number }>;
  squadRules: SquadRule[];
}) {
  if (players.length === 0) return null;
  const balance = roleBalance(players, squadRules);
  const best = bestValueBuy(players);
  return (
    <div className="space-y-2 border-b border-slate-800 px-4 py-3">
      <ul className="flex flex-wrap gap-1.5" aria-label="Role balance">
        {balance.map((row) => (
          <li
            key={row.role}
            className={`rounded px-2 py-0.5 text-xs tabular-nums ${row.gap > 0 ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-800 text-slate-300'}`}
            title={row.min !== undefined ? `${row.role}: ${row.count} (needed ${row.min})` : `${row.role}: ${row.count}`}
          >
            {ROLE_SHORT[row.role]} {row.count}
            {row.min !== undefined && <span className="opacity-70">/{row.min}</span>}
          </li>
        ))}
      </ul>
      {best && (
        <p className="text-xs text-slate-400">
          Best value: <span className="font-semibold text-slate-100">{best.name}</span> at {formatCurrency(best.soldPrice)}{' '}
          <span className="text-slate-500">(base {formatCurrency(best.basePrice)})</span>
        </p>
      )}
    </div>
  );
}

/** Public results: squads by team, top buys and spend. No sign-in needed. */
export function ResultsView({ tournamentId }: { tournamentId: string }) {
  const results = useQuery(api.results.getPublicResults, {
    tournamentId: tournamentId as Id<"tournaments">,
  });

  if (results === undefined) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" aria-label="Loading results" />
      </main>
    );
  }

  if (results === null) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <h1 className="text-2xl font-bold">Results not available</h1>
          <p className="text-slate-400">They appear here once the auction is complete.</p>
        </div>
      </main>
    );
  }

  const { tournament, teams, topBuys, totals, categories, squadRules } = results;
  const teamById = new Map(teams.map((t) => [t._id, t]));
  const completed = new Date(tournament.completedAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12 space-y-8 sm:space-y-10">
        {/* Header */}
        <header className="flex items-center gap-4">
          <ImgWithFallback
            src={tournament.logoUrl}
            alt=""
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-contain bg-slate-900 border border-slate-700"
            fallback={
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-yellow-500/15 flex items-center justify-center">
                <Trophy className="w-9 h-9 text-yellow-500" />
              </div>
            }
          />
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-semibold uppercase tracking-widest text-slate-400">Auction results</p>
            <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight break-words">{tournament.name}</h1>
            <p className="text-sm text-slate-400">Completed {completed}</p>
          </div>
        </header>

        {/* Headline numbers */}
        <section className="grid grid-cols-3 gap-3" aria-label="Summary">
          {[
            ['Players sold', String(totals.sold)],
            ['Total spent', formatCurrency(totals.spent)],
            ['Unsold', String(totals.unsold)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-800 bg-slate-900 p-3 sm:p-4">
              <div className="text-xs sm:text-sm text-slate-400">{label}</div>
              <div className="text-xl sm:text-3xl font-bold tabular-nums">{value}</div>
            </div>
          ))}
        </section>

        {/* Top buys */}
        {topBuys.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl font-bold">Top buys</h2>
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {topBuys.map((p, i) => {
                const team = p.teamId ? teamById.get(p.teamId) : undefined;
                return (
                  <li key={p._id} className="flex lg:flex-col items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3 lg:text-center">
                    <div className="relative shrink-0">
                      <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="lg" className="rounded-xl" />
                      <span className="absolute -top-2 -left-2 flex h-6 w-6 items-center justify-center rounded-full bg-yellow-500 text-xs font-bold text-slate-950">{i + 1}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{p.name}</div>
                      <div className="text-xs text-slate-400 truncate">{team?.name}</div>
                      <div className="text-lg font-bold text-yellow-400 tabular-nums">{formatCurrency(p.soldPrice)}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {/* Spend */}
        <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
          <h2 className="text-xl font-bold">Spend by team</h2>
          <SpendChart teams={teams} basePurse={tournament.basePurse} />
        </section>

        {/* Squads */}
        <section className="space-y-3">
          <h2 className="text-xl font-bold">Squads</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <article key={team._id} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
                <div className="flex items-center gap-3 border-b-4 p-4" style={{ borderBottomColor: team.colorPrimary }}>
                  <TeamLogo name={team.name} logoUrl={team.logoUrl} primaryColor={team.colorPrimary} size="md" />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold truncate">{team.name}</h3>
                    <p className="text-xs text-slate-400 tabular-nums">
                      {team.players.length} players · {formatCurrency(team.purseSpent)} spent · {formatCurrency(team.purseRemaining)} left
                    </p>
                  </div>
                </div>
                <SquadSummary players={team.players} squadRules={squadRules} />
                <ul className="divide-y divide-slate-800">
                  {team.captain && (
                    <li className="flex items-center gap-3 px-4 py-2.5">
                      <PlayerAvatar name={team.captain.name} photoUrl={team.captain.photoUrl} size="md" className="rounded-lg" />
                      <span className="flex-1 min-w-0 truncate text-sm font-medium">{team.captain.name}</span>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-yellow-400">
                        <Crown className="w-3.5 h-3.5" /> Captain
                      </span>
                    </li>
                  )}
                  {team.players.map((p) => (
                    <li key={p._id} className="flex items-center gap-3 px-4 py-2.5">
                      <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="md" className="rounded-lg" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <span className="truncate">{getRoleDisplay(p.role)}</span>
                          <CategoryChip categoryId={p.categoryId} categories={categories} />
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-yellow-400 tabular-nums">{formatCurrency(p.soldPrice)}</span>
                    </li>
                  ))}
                  {team.players.length === 0 && !team.captain && (
                    <li className="px-4 py-3 text-sm text-slate-500">No players</li>
                  )}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <footer className="pt-4 text-center text-sm text-slate-500">
          Auction run on <Link href="/" className="text-slate-300 hover:underline">Bid11Pro</Link>
        </footer>
      </div>
    </main>
  );
}
