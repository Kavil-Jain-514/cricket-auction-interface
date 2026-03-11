"use client";

import { useMemo } from 'react';
import { Users, Gavel } from 'lucide-react';
import { TeamLogo } from '@/components/ui/team-logo';
import { formatCurrency } from '@/lib/utils';

export interface ViewerTeamsPanelProps {
  teams: Array<{
    _id: string;
    name: string;
    logoUrl?: string;
    colorPrimary: string;
    purseRemaining: number;
    playerCount?: number;
  }>;
  soldPlayers: Array<{ _id: string; teamId?: string }> | undefined;
  maxPlayersPerTeam: number;
  currentBidTeamId?: string;
}

export function ViewerTeamsPanel({
  teams,
  soldPlayers,
  maxPlayersPerTeam,
  currentBidTeamId,
}: ViewerTeamsPanelProps) {
  const playerCountByTeam = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of soldPlayers ?? []) {
      if (p.teamId) map[p.teamId] = (map[p.teamId] ?? 0) + 1;
    }
    return map;
  }, [soldPlayers]);

  return (
    <aside className="col-span-10 lg:col-span-3 order-2">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-2 text-slate-300">
        <Users className="w-4 h-4" />
        Teams
      </h3>
      {/* Mobile: horizontal scroll strip; Desktop: 2-column grid */}
      <div className="flex overflow-x-auto pb-1 gap-2 lg:grid lg:grid-cols-2 lg:overflow-visible scrollbar-none">
        {teams?.map((team) => {
          const teamPlayerCount = team.playerCount ?? (playerCountByTeam[team._id] ?? 0);
          const isCurrentBidder = team._id === currentBidTeamId;
          return (
            <div
              key={team._id}
              className={`shrink-0 w-36 lg:w-auto rounded-xl p-2.5 border-2 transition-all ${
                isCurrentBidder
                  ? 'border-yellow-500 bg-yellow-500/10 shadow-lg shadow-yellow-500/20'
                  : 'border-slate-700 bg-slate-800/50'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <TeamLogo
                  name={team.name}
                  logoUrl={team.logoUrl}
                  primaryColor={team.colorPrimary}
                  size="sm"
                />
                <span className="font-semibold text-xs truncate flex-1">{team.name}</span>
                {isCurrentBidder && (
                  <Gavel className="w-3 h-3 text-yellow-500 animate-pulse shrink-0" />
                )}
              </div>
              <div className="text-xs text-slate-400 space-y-0.5">
                <div className="text-green-400 font-medium truncate">
                  {formatCurrency(team.purseRemaining)}
                </div>
                <div>
                  {teamPlayerCount}/{maxPlayersPerTeam} players
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
