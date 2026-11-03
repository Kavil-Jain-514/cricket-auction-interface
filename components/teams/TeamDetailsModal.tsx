"use client";

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { X, Users, Crown } from 'lucide-react';
import { cn, formatCurrency, getRoles } from '@/lib/utils';
import { motion } from 'framer-motion';
import { PlayerAvatarCircle } from '@/components/ui/player-avatar';
import { TeamLogo } from '@/components/ui/team-logo';
import { FormTabs } from '@/components/ui/form-modal';
import { useTournamentRole } from '@/hooks/useTournamentRole';
import { PurseTools } from './PurseTools';

interface TeamDetailsModalProps {
  teamId: Id<"teams">;
  onClose: () => void;
}

const roleColors: Record<string, string> = {
  'Batter': 'bg-blue-600',
  'Bowler': 'bg-red-600',
  'All-Rounder': 'bg-purple-600',
  'Wicket Keeper': 'bg-emerald-600',
};

const COMPOSITION = [
  { role: 'Batter', label: 'Batters', cls: 'text-blue-400 bg-blue-600/10 border-blue-600/30' },
  { role: 'Bowler', label: 'Bowlers', cls: 'text-red-400 bg-red-600/10 border-red-600/30' },
  { role: 'All-Rounder', label: 'All-Rounders', cls: 'text-purple-400 bg-purple-600/10 border-purple-600/30' },
  { role: 'Wicket Keeper', label: 'Keepers', cls: 'text-emerald-400 bg-emerald-600/10 border-emerald-600/30' },
] as const;

export function TeamDetailsModal({ teamId, onClose }: TeamDetailsModalProps) {
  const teamData = useQuery(api.teams.getWithPlayers, { id: teamId });
  // Owners and auctioneers can use the purse tools.
  const { canRunAuction } = useTournamentRole(teamData?.tournamentId);
  const [tab, setTab] = useState<'squad' | 'purse'>('squad');

  if (!teamData) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  const { players, ...team } = teamData;
  const purseTotal = team.purseRemaining + team.purseSpent;
  const usedPercentage = purseTotal > 0 ? (team.purseSpent / purseTotal) * 100 : 0;
  const squad = [...players].sort((a, b) => (b.soldPrice || 0) - (a.soldPrice || 0));
  const topPlayers = squad.slice(0, 2);

  const stats = [
    { label: 'Squad', value: String(players.length), cls: 'text-white' },
    { label: 'Purse left', value: formatCurrency(team.purseRemaining), cls: 'text-green-400' },
    { label: 'Spent', value: formatCurrency(team.purseSpent), cls: 'text-orange-400' },
    { label: 'Avg price', value: players.length > 0 ? formatCurrency(team.purseSpent / players.length) : '₹0', cls: 'text-yellow-400' },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header in the team's colours */}
        <div
          className="relative shrink-0 px-5 pt-4 pb-3 sm:px-6"
          style={{ background: `linear-gradient(120deg, ${team.colorPrimary}40, rgb(15 23 42) 55%, ${team.colorSecondary}26)` }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-black/30 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex flex-col gap-4 pr-10 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <TeamLogo name={team.name} logoUrl={team.logoUrl} primaryColor={team.colorPrimary} size="lg" />
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-bold sm:text-3xl">{team.name}</h2>
                <p className="truncate text-sm text-slate-300">
                  Owner: {team.ownerName}
                  {team.sponsorName && <span className="text-slate-400"> · Sponsor: {team.sponsorName}</span>}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-4 gap-2 sm:gap-3">
              {stats.map((s) => (
                <div key={s.label} className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-center">
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400">{s.label}</dt>
                  <dd className={cn('text-sm font-bold tabular-nums sm:text-base', s.cls)}>{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Purse used */}
          <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
            <div className="h-2 flex-1 rounded-full bg-slate-800">
              <motion.div
                className="h-2 rounded-full"
                style={{ background: `linear-gradient(90deg, ${team.colorPrimary}, ${team.colorSecondary})` }}
                initial={{ width: 0 }}
                animate={{ width: `${usedPercentage}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
            <span className="shrink-0 font-semibold text-slate-300">{usedPercentage.toFixed(1)}% of purse used</span>
          </div>

          {canRunAuction && (
            <div className="mt-3 max-w-xs">
              <FormTabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { key: 'squad', label: 'Squad' },
                  { key: 'purse', label: 'Purse tools' },
                ]}
              />
            </div>
          )}
        </div>

        {tab === 'purse' && canRunAuction ? (
          <div className="min-h-0 flex-1 overflow-y-auto ipad-scroll px-5 pb-5 sm:px-6 [&>section]:mt-4">
            <PurseTools team={team} players={players} />
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto ipad-scroll p-5 sm:px-6 lg:grid-cols-[17rem_1fr] lg:overflow-hidden">
            {/* Side: captain, composition, top buys */}
            <aside className="space-y-4">
              {team.captainName && (
                <div className="flex items-center gap-3 rounded-xl border border-yellow-500/30 bg-linear-to-r from-yellow-500/10 to-orange-500/10 p-3">
                  <PlayerAvatarCircle name={team.captainName} photoUrl={team.captainPhotoUrl} size="md" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-yellow-400">
                      <Crown className="h-3.5 w-3.5" /> Captain
                    </div>
                    <div className="truncate font-bold">{team.captainName}</div>
                    <div className="truncate text-xs text-slate-400">
                      {[team.captainRole, team.captainAge && `${team.captainAge} yrs`, team.captainHand && `${team.captainHand}-handed`]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Composition</h3>
                <div className="grid grid-cols-4 gap-2 lg:grid-cols-2">
                  {COMPOSITION.map((c) => (
                    <div key={c.role} className={cn('rounded-lg border px-2 py-2 text-center', c.cls)}>
                      <div className="text-xl font-bold leading-none">
                        {players.filter((p) => getRoles(p.role).includes(c.role)).length}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">{c.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {topPlayers.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Top buys</h3>
                  <ol className="space-y-1.5">
                    {topPlayers.map((player, idx) => (
                      <li key={player._id} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-2.5 py-2">
                        <span className="w-4 text-xs font-bold text-slate-500">{idx + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{player.name}</span>
                        <span className="text-sm font-bold text-yellow-400">{formatCurrency(player.soldPrice || 0)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </aside>

            {/* Squad */}
            <section className="flex min-h-0 flex-col">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Users className="h-3.5 w-3.5" /> Squad ({players.length})
              </h3>
              {players.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 py-10 text-slate-400">
                  <Users className="mb-2 h-10 w-10 opacity-50" />
                  <p className="text-sm">No players in the squad yet</p>
                </div>
              ) : (
                <ul className="grid min-h-0 grid-cols-1 content-start gap-2 sm:grid-cols-2 xl:grid-cols-3 lg:overflow-y-auto lg:pr-1 ipad-scroll">
                  {squad.map((player) => (
                    <li key={player._id} className="flex items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-800/40 px-2.5 py-2">
                      <PlayerAvatarCircle name={player.name} photoUrl={player.photoUrl} size="sm" showBorder={false} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{player.name}</div>
                        <div className="mt-0.5 flex items-center gap-1">
                          {getRoles(player.role).map((r) => (
                            <span key={r} className={cn('rounded px-1.5 py-px text-[10px] font-semibold', roleColors[r] || 'bg-slate-600')}>
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                      <span className="text-sm font-bold tabular-nums text-green-400">{formatCurrency(player.soldPrice || 0)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </motion.div>
    </div>
  );
}
