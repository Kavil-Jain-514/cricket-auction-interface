"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { TeamLogo } from '@/components/ui/team-logo';
import { getErrorMessage } from '@/lib/utils';

/** Owners verify teams that team owners asked for. Hidden when none are waiting. */
export function TeamRequestsPanel({ tournamentId }: { tournamentId: Id<"tournaments"> }) {
  const requests = useQuery(api.teamRequests.listForTournament, { tournamentId });
  const approve = useMutation(api.teamRequests.approve);
  const reject = useMutation(api.teamRequests.reject);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: Id<"teamRequests">; name: string } | null>(null);
  const [reason, setReason] = useState('');

  const pending = (requests ?? []).filter((r) => r.status === 'pending');
  if (pending.length === 0) return null;

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Something went wrong'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4" aria-labelledby="team-requests-title">
      <h2 id="team-requests-title" className="mb-1 flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-4 w-4 text-blue-400" /> Teams waiting for verification ({pending.length})
      </h2>
      <p className="mb-3 text-xs text-slate-400">Team owners who signed up asked for these teams. Approving creates the team and links the owner so they can bid.</p>
      <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
        {pending.map((r) => (
          <li key={r._id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <TeamLogo name={r.name} logoUrl={r.logoUrl} primaryColor={r.colorPrimary} size="sm" />
              <div className="min-w-0">
                <div className="truncate font-semibold">{r.name}</div>
                <div className="truncate text-xs text-slate-400">
                  Owner {r.ownerName} · {r.requesterName ? `${r.requesterName}, ` : ''}{r.requesterEmail}
                  {r.sponsorName ? ` · Sponsor ${r.sponsorName}` : ''}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { setReason(''); setRejecting({ id: r._id, name: r.name }); }} className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">
                Reject
              </Button>
              <Button size="sm" disabled={busy !== null} onClick={() => run(r._id, () => approve({ requestId: r._id }), `${r.name} added`)}>
                Verify &amp; add team
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setRejecting(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="reject-team-title" className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 id="reject-team-title" className="mb-3 text-lg font-bold">Reject {rejecting.name}?</h2>
            <label htmlFor="reject-team-reason" className="text-xs text-slate-400">Reason (the owner sees it)</label>
            <textarea id="reject-team-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoFocus className="mt-1 min-h-20 w-full rounded-md border border-slate-600 bg-slate-800 p-2 text-sm text-white" />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejecting(null)} className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">Cancel</Button>
              <Button
                variant="destructive"
                disabled={!reason.trim() || busy !== null}
                onClick={() => run(rejecting.id, async () => { await reject({ requestId: rejecting.id, reason }); setRejecting(null); }, `${rejecting.name} rejected`)}
              >
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
