"use client";

// Automatic snapshots (AUDIT 2026-10 Phase 5): taken before the auction
// starts, before a restart, a delete, a rehearsal and a restore. Owners can
// rewind the tournament to any of them; the server re-checks everything.

import { useMutation, useQuery } from 'convex/react';
import { History } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { getErrorMessage } from '@/lib/utils';

const REASONS: Record<string, string> = {
  'before start_auction': 'Before the auction started',
  'before restart_auction': 'Before a restart',
  'before delete_tournament': 'Before a delete',
  'before rehearsal': 'Before a rehearsal',
  'before restore_snapshot': 'Before a restore',
};

export function SnapshotsCard({ tournamentId, tournamentName }: { tournamentId: Id<"tournaments">; tournamentName: string }) {
  const snapshots = useQuery(api.snapshots.listForTournament, { tournamentId });
  const restore = useMutation(api.snapshots.restoreSnapshot);
  const confirm = useConfirm();

  if (!snapshots || snapshots.length === 0) return null;

  const onRestore = async (snapshotId: Id<"tournamentSnapshots">, label: string) => {
    if (!(await confirm({
      title: 'Restore this snapshot?',
      description: `Every player, purse and bid goes back to "${label}". The current state is saved as a snapshot first, so you can undo this. A live auction must be paused.`,
      confirmText: 'Restore',
      requireTypedText: tournamentName,
    }))) return;
    try {
      await restore({ snapshotId, confirmName: tournamentName });
      toast.success('Snapshot restored. Rooms that were live are paused: resume when ready.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not restore the snapshot'));
    }
  };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <History className="h-4 w-4 text-slate-400" /> Snapshots
      </h2>
      <ul className="space-y-2">
        {snapshots.slice(0, 5).map((s) => {
          const label = REASONS[s.reason] ?? s.reason;
          return (
            <li key={s._id} className="flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <div className="text-slate-200">{label}</div>
                <div className="text-slate-500">
                  {new Date(s.createdAt).toLocaleString('en-IN')} · {s.counts.players} players · {s.counts.bids} sales
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => onRestore(s._id, label)}>
                Restore
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
