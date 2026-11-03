"use client";

import Link from 'next/link';
import { useQuery } from 'convex/react';
import { Shield } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { TeamLogo } from '@/components/ui/team-logo';
import { cn } from '@/lib/utils';

const STATUS = {
  pending: { label: 'Waiting for verification', cls: 'bg-amber-500/15 text-amber-300' },
  approved: { label: 'Verified', cls: 'bg-green-500/15 text-green-300' },
  rejected: { label: 'Rejected', cls: 'bg-red-500/15 text-red-300' },
} as const;

/**
 * Dashboard panel for team owners: their team requests. Requests start on a
 * tournament page the organiser shares (or an owner invite link), so there
 * is no list of every tournament to pick from here.
 */
export function TeamOwnerPanel() {
  const requests = useQuery(api.teamRequests.listMine, {});
  if (!requests || requests.length === 0) return null;

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 sm:p-5" aria-labelledby="my-teams-title">
      <h2 id="my-teams-title" className="flex items-center gap-2 text-lg font-bold">
        <Shield className="h-5 w-5 text-blue-400" aria-hidden /> My team requests
      </h2>
      <p className="text-sm text-slate-400">The organiser verifies each team before you can bid.</p>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {requests.map((r) => (
          <li key={r._id}>
            <Link href={`/tournament/${r.tournamentId}`} className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3 transition hover:border-blue-500/50">
              <TeamLogo name={r.name} logoUrl={r.logoUrl} primaryColor={r.colorPrimary} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{r.name}</div>
                <div className="truncate text-xs text-slate-400">
                  {r.tournamentName}
                  {r.rejectReason ? ` · ${r.rejectReason}` : ''}
                </div>
              </div>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', STATUS[r.status].cls)}>{STATUS[r.status].label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
