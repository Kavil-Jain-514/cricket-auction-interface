"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { Shield, Plus } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { TeamLogo } from '@/components/ui/team-logo';
import { cn } from '@/lib/utils';
import { TeamRequestForm } from './TeamRequestForm';

const STATUS = {
  pending: { label: 'Waiting for verification', cls: 'bg-amber-500/15 text-amber-300' },
  approved: { label: 'Verified', cls: 'bg-green-500/15 text-green-300' },
  rejected: { label: 'Rejected', cls: 'bg-red-500/15 text-red-300' },
} as const;

/** Dashboard panel for team owners: their requests and a way to register a team. */
export function TeamOwnerPanel({
  tournaments,
  ownerName,
}: {
  tournaments: Array<{ _id: Id<"tournaments">; name: string; status: string }>;
  ownerName?: string;
}) {
  const requests = useQuery(api.teamRequests.listMine, {});
  const open = tournaments.filter((t) => t.status !== 'completed');
  const [pick, setPick] = useState<string>('');
  const [registering, setRegistering] = useState<{ id: Id<"tournaments">; name: string } | null>(null);
  const selected = open.find((t) => t._id === pick) ?? open[0];

  return (
    <section className="mb-6 rounded-xl border border-slate-700 bg-slate-800/50 p-4 sm:p-5" aria-labelledby="my-teams-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="my-teams-title" className="flex items-center gap-2 text-lg font-bold">
            <Shield className="h-5 w-5 text-blue-400" /> My teams
          </h2>
          <p className="text-sm text-slate-400">Register your team in a tournament; the organiser verifies it.</p>
        </div>
        {open.length > 0 && (
          <div className="flex gap-2">
            <NativeSelect aria-label="Tournament" value={selected?._id ?? ''} onChange={(e) => setPick(e.target.value)} className="h-10 w-56">
              {open.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
            </NativeSelect>
            <Button className="h-10" disabled={!selected} onClick={() => selected && setRegistering({ id: selected._id, name: selected.name })}>
              <Plus className="h-4 w-4" /> Register team
            </Button>
          </div>
        )}
      </div>

      {requests && requests.length > 0 && (
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
      )}

      {registering && (
        <TeamRequestForm
          tournamentId={registering.id}
          tournamentName={registering.name}
          defaultOwnerName={ownerName}
          onClose={() => setRegistering(null)}
        />
      )}
    </section>
  );
}
