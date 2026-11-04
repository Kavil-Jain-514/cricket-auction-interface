"use client";

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { Lock, Pencil, Shield } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { TeamLogo } from '@/components/ui/team-logo';
import { TeamEditForm } from './TeamEditForm';

/**
 * A team owner's own team on the tournament page. They edit its details
 * until the auction starts; teams:getMine says live when that happens, so an
 * open form locks in place. Renders nothing for anyone who owns no team here.
 */
export function MyTeamCard({ tournamentId }: { tournamentId: Id<"tournaments"> }) {
  const mine = useQuery(api.teams.getMine, { tournamentId });
  const [editing, setEditing] = useState(false);
  if (!mine) return null;
  const { team, editLocked } = mine;

  return (
    <section aria-labelledby="my-team-title" className="mb-6 sm:mb-8 max-w-md rounded-xl border border-slate-700 bg-slate-800/50 p-4 sm:p-5">
      <h2 id="my-team-title" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
        <Shield className="h-4 w-4 text-blue-400" aria-hidden /> My team
      </h2>
      <div className="mt-3 flex items-center gap-3">
        <TeamLogo name={team.name} logoUrl={team.logoUrl} primaryColor={team.colorPrimary} size="md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold">{team.name}</div>
          <div className="truncate text-sm text-slate-400">
            {team.ownerName}
            {team.sponsorName ? ` · ${team.sponsorName}` : ''}
          </div>
        </div>
      </div>
      {editLocked ? (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-300">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
          Team details are locked because the auction has started.
        </p>
      ) : (
        <Button onClick={() => setEditing(true)} variant="outline" className="mt-4 h-11 w-full px-4 text-sm sm:w-auto">
          <Pencil className="mr-2 h-4 w-4" aria-hidden /> Edit team details
        </Button>
      )}
      {editing && (
        <TeamEditForm
          team={team}
          asTeamOwner
          locked={editLocked}
          onClose={() => setEditing(false)}
          onSuccess={() => setEditing(false)}
        />
      )}
    </section>
  );
}
