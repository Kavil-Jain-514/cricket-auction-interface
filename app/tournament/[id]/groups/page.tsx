"use client";

import { use, useMemo, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import Link from 'next/link';
import { ArrowLeft, Eye, Layers, Lock, RotateCcw, Shuffle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/utils';
import { useUserRole } from '@/hooks/useUserRole';
import { GroupDrawSetup } from '@/components/groups/GroupDrawSetup';
import { GroupDrawReveal } from '@/components/groups/GroupDrawReveal';
import { GroupTable } from '@/components/groups/GroupTable';

export default function GroupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tournamentId = id as Id<"tournaments">;
  const { isAdmin } = useUserRole();

  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });
  const teams = useQuery(api.teams.listByTournament, { tournamentId });
  const draw = useQuery(api.groupDraws.getByTournament, { tournamentId });

  const runDraw = useMutation(api.groupDraws.runDraw);
  const lockDraw = useMutation(api.groupDraws.lockDraw);
  const resetDraw = useMutation(api.groupDraws.resetDraw);

  const [running, setRunning] = useState(false);
  const [revealing, setRevealing] = useState(false);

  const teamsById = useMemo(
    () => new Map((teams ?? []).map((t) => [t._id, t])),
    [teams],
  );

  const startDraw = async (numGroups: number) => {
    setRunning(true);
    try {
      // The full random assignment is computed and persisted server-side
      // first; the reveal below only animates that already-decided result.
      await runDraw({ tournamentId, numGroups });
      setRevealing(true);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to run the group draw'));
    } finally {
      setRunning(false);
    }
  };

  const handleReshuffle = async () => {
    if (!draw) return;
    if (!confirm('Re-shuffle the draw? This clears the previous group assignments and cannot be undone.')) {
      return;
    }
    await startDraw(draw.numGroups);
  };

  const handleLock = async () => {
    if (!confirm('Lock the group draw? Assignments cannot be re-shuffled after locking.')) {
      return;
    }
    try {
      await lockDraw({ tournamentId });
      toast.success('Group draw locked');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to lock the draw'));
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset the group draw? This deletes all group assignments so you can configure a new draw.')) {
      return;
    }
    try {
      await resetDraw({ tournamentId });
      toast.success('Group draw reset');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to reset the draw'));
    }
  };

  const loading = teams === undefined || draw === undefined;

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <Link href={`/tournament/${tournamentId}`} className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition mb-4 min-h-11 touch-target">
            <ArrowLeft className="w-5 h-5" />
            <span>Back to Tournament</span>
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2">Group Draw</h1>
              <p className="text-slate-400 text-sm sm:text-base">{tournament?.name}</p>
            </div>

            <div className="flex flex-wrap gap-2 sm:gap-3">
              {/* Viewer Mode Indicator */}
              {!isAdmin && (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/60 rounded-lg border border-slate-700 min-h-11">
                  <Eye className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-slate-300">Viewer Mode</span>
                </div>
              )}

              {/* Admin actions on an existing draw */}
              {isAdmin && draw && draw.status === 'drawn' && (
                <>
                  <Button
                    variant="outline"
                    onClick={handleReshuffle}
                    disabled={running}
                    className="border-orange-600 text-orange-500 hover:bg-orange-600 hover:text-white h-11 px-4 text-sm"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {running ? 'Drawing…' : 'Re-shuffle'}
                  </Button>
                  <Button onClick={handleLock} className="bg-green-600 hover:bg-green-700 h-11 px-4 text-sm">
                    <Lock className="w-4 h-4 mr-2" />
                    Confirm & Lock
                  </Button>
                </>
              )}
              {isAdmin && draw && draw.status === 'locked' && (
                <Button
                  variant="outline"
                  onClick={handleReset}
                  className="border-red-600 text-red-600 hover:bg-red-600 hover:text-white h-11 px-4 text-sm"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Reset Draw
                </Button>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 sm:py-20">
            <div className="animate-spin rounded-full h-10 w-10 sm:h-12 sm:w-12 border-b-2 border-blue-500" />
          </div>
        ) : draw ? (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <p className="text-sm text-slate-400">
                {draw.assignments.length} teams across {draw.numGroups} group{draw.numGroups !== 1 ? 's' : ''}
              </p>
              {draw.status === 'locked' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-xs font-semibold text-yellow-400">
                  <Lock className="w-3 h-3" />
                  Locked
                </span>
              )}
            </div>
            <GroupTable
              assignments={draw.assignments}
              teamsById={teamsById}
              locked={draw.status === 'locked'}
            />
          </>
        ) : isAdmin ? (
          teams && teams.length > 0 ? (
            <GroupDrawSetup teamCount={teams.length} onRun={startDraw} running={running} />
          ) : (
            <div className="text-center py-16 sm:py-20 px-4">
              <Layers className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 text-slate-700" />
              <h3 className="text-lg sm:text-xl font-semibold mb-2">No teams yet</h3>
              <p className="text-slate-400 mb-6 text-sm sm:text-base">
                Add teams to the tournament before running a group draw
              </p>
              <Link href={`/tournament/${tournamentId}/teams`}>
                <Button className="min-h-11 touch-target">Manage Teams</Button>
              </Link>
            </div>
          )
        ) : (
          <div className="text-center py-16 sm:py-20 px-4">
            <Shuffle className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 text-slate-700" />
            <h3 className="text-lg sm:text-xl font-semibold mb-2">No draw yet</h3>
            <p className="text-slate-400 text-sm sm:text-base">
              The group draw hasn&apos;t been run for this tournament yet
            </p>
          </div>
        )}

        {/* Draw ceremony overlay — animates the persisted result */}
        {revealing && draw && (
          <GroupDrawReveal
            key={draw.updatedAt}
            assignments={draw.assignments}
            teamsById={teamsById}
            onComplete={() => setRevealing(false)}
          />
        )}
      </main>
    </div>
  );
}
