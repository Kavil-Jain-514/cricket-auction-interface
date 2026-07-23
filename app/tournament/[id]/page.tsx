"use client";

import { use, useMemo, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import Link from 'next/link';
import { ArrowLeft, Users, UserPlus, Trophy, Settings, Play, Trash2, RotateCcw, Eye, Layers, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { formatCurrency, getErrorMessage, getCaptainPlayerIds } from '@/lib/utils';
import { TournamentSettingsModal } from '@/components/tournament/TournamentSettingsModal';
import { useUserRole } from '@/hooks/useUserRole';
import { useConfirm } from '@/components/ui/confirm-dialog';

export default function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const tournamentId = id as Id<"tournaments">;
  const [showSettings, setShowSettings] = useState(false);
  const { isAdmin } = useUserRole();
  const confirm = useConfirm();

  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });
  const teams = useQuery(api.teams.listByTournament, { tournamentId });
  const players = useQuery(api.players.listByTournament, { tournamentId });
  const canModify = useQuery(api.tournaments.canModify, { id: tournamentId });
  const deleteTournament = useMutation(api.tournaments.deleteTournament);
  const restartAuction = useMutation(api.auctions.restartAuction);

  // Team captains are pre-assigned and never auctioned, so they're excluded from
  // every count shown on the dashboard (total / pending / sold).
  const auctionablePlayers = useMemo(() => {
    if (!players) return [];
    const captainIds = getCaptainPlayerIds(teams);
    return players.filter((p) => !captainIds.has(p._id));
  }, [players, teams]);
  const playerCount = auctionablePlayers.length;

  const [deleting, setDeleting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const auctionRooms = useQuery(api.auctions.getAuctionRooms, { tournamentId });
  const groupDraw = useQuery(api.groupDraws.getByTournament, { tournamentId });

  const canResumeAuction = () => {
    if (!tournament) return false;

    // Any existing room (even one created but never started) should stay
    // reachable from here — otherwise an admin who created a room, then had
    // its only pending players removed before starting it, would have no
    // button anywhere linking back to that room. Completed tournaments get
    // their own "View Results" action instead.
    return (
      tournament.status !== 'completed' &&
      Boolean(auctionRooms && auctionRooms.length > 0)
    );
  };

  // Add this function to handle resume
  const handleResumeAuction = () => {
    if (!auctionRooms || auctionRooms.length === 0) {
      toast.error('No auction room found');
      return;
    }

    const activeRoom = auctionRooms[0];
    router.push(`/auction/${activeRoom._id}`);
  };

  // Copy a shareable link to the live auction viewer so admins can hand it out
  // to anyone who wants to watch (the /auction/[roomId] page is view-accessible
  // to non-admins).
  const handleCopyAuctionLink = async () => {
    if (!auctionRooms || auctionRooms.length === 0) {
      toast.error('No auction room found');
      return;
    }

    const activeRoom = auctionRooms[0];
    const url = `${window.location.origin}/auction/${activeRoom._id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Auction link copied to clipboard');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to copy link'));
    }
  };

  const handleStartAuction = () => {
    if (!teams || teams.length < 2) {
      toast.error('You need at least 2 teams to start an auction');
      return;
    }
    if (auctionablePlayers.length === 0) {
      toast.error('You need to add players before starting');
      return;
    }

    // Tournament status flips to 'active' only once the auction room actually
    // goes live (see auctions:startAuction) — not here. Setting it eagerly
    // left tournaments stuck "active" with no room if this flow was abandoned
    // before the room was created, with no way back into the UI to recover.
    router.push(`/auction/create?tournamentId=${tournamentId}`);
  };

  const handleDelete = async () => {
    const liveWarning = tournament?.status === 'active'
      ? 'This auction is currently LIVE — viewers may be watching right now.\n\n'
      : '';
    if (!(await confirm({
      title: `Delete "${tournament?.name}"?`,
      description: `${liveWarning}This will permanently delete all teams, players, and auction data. This action cannot be undone.`,
      confirmText: 'Delete Tournament',
    }))) {
      return;
    }

    setDeleting(true);
    try {
      await deleteTournament({ id: tournamentId });
      toast.success('Tournament deleted successfully');
      router.push('/dashboard');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete tournament'));
      setDeleting(false);
    }
  };

  const handleRestartAuction = async () => {
    if (!auctionRooms || auctionRooms.length === 0) {
      toast.error('No auction room found to restart');
      return;
    }

    if (!(await confirm({
      title: 'Restart auction?',
      description: 'This will reset all player sales, team purses, and auction history. This action cannot be undone.',
      confirmText: 'Restart Auction',
    }))) {
      return;
    }

    setRestarting(true);
    try {
      const activeRoom = auctionRooms[0];
      await restartAuction({ auctionRoomId: activeRoom._id });
      toast.success('Auction restarted successfully! All players and teams have been reset.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to restart auction'));
    } finally {
      setRestarting(false);
    }
  };

  if (!tournament) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950">
        <Navbar />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
        </div>
      </div>
    );
  }

  const pendingPlayers = auctionablePlayers.filter(p => p.auctionStatus === 'pending').length;
  const soldPlayers = auctionablePlayers.filter(p => p.auctionStatus === 'sold').length;

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 safe-bottom">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition mb-4 py-2 touch-target">
            <ArrowLeft className="w-5 h-5" />
            <span>Back to Dashboard</span>
          </Link>

          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 lg:gap-6">
            <div className="flex items-start gap-3 sm:gap-4">
              {/* Tournament Logo */}
              {tournament.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={tournament.logoUrl}
                  alt={`${tournament.name} logo`}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover border border-slate-600 shrink-0"
                />
              ) : (
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-yellow-500/20 flex items-center justify-center shrink-0">
                  <Trophy className="w-8 h-8 sm:w-10 sm:h-10 text-yellow-500" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold">{tournament.name}</h1>
                  <span className={`px-3 py-1 rounded-full text-xs sm:text-sm font-semibold ${tournament.status === 'active' ? 'bg-green-600' :
                    tournament.status === 'setup' ? 'bg-blue-600' :
                      tournament.status === 'completed' ? 'bg-purple-600' :
                        'bg-slate-600'
                    }`}>
                    {tournament.status}
                  </span>
                </div>
                {tournament.description && (
                  <p className="text-slate-400 mt-1 text-sm sm:text-base">{tournament.description}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 sm:gap-3">
              {/* Viewer Mode Indicator for non-admins */}
              {!isAdmin && (
                <div className="flex items-center gap-2 px-4 py-2 bg-slate-800/60 rounded-lg border border-slate-700 h-11">
                  <Eye className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-slate-300">Viewer Mode</span>
                </div>
              )}

              {/* Admin-only controls */}
              {isAdmin && canModify?.canEdit && (
                <Button variant="outline" size="sm" onClick={() => setShowSettings(true)} className="h-11 px-4 text-sm">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </Button>
              )}

              {isAdmin && canModify?.canDelete && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="border-red-600 text-red-600 hover:bg-red-600 hover:text-white h-11 px-4 text-sm"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
              )}

              {isAdmin && (
                <Button
                  onClick={handleStartAuction}
                  disabled={
                    tournament.status === 'active' ||
                    tournament.status === 'completed' ||
                    Boolean(auctionRooms && auctionRooms.length > 0)
                  }
                  title={
                    auctionRooms && auctionRooms.length > 0
                      ? 'An auction room already exists for this tournament — use Resume Auction instead'
                      : undefined
                  }
                  className="h-11 px-4 sm:px-5 text-sm"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Start Auction
                </Button>
              )}

              {/* View Auction Button - visible to ALL users when auction exists */}
              {!isAdmin && auctionRooms && auctionRooms.length > 0 && (tournament.status === 'active') && (
                <Button
                  onClick={handleResumeAuction}
                  className="bg-blue-600 hover:bg-blue-700 h-11 px-4 sm:px-5 text-sm"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  View Live Auction
                </Button>
              )}

              {isAdmin && canResumeAuction() && (
                <Button
                  onClick={handleResumeAuction}
                  className="bg-green-600 hover:bg-green-700 h-11 px-4 sm:px-5 text-sm"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Resume Auction
                </Button>
              )}

              {/* View Results - the only way back to the complete screen once a
                  tournament is done; without it there's no link anywhere back
                  to /auction/[roomId] after navigating away. */}
              {tournament.status === 'completed' && auctionRooms && auctionRooms.length > 0 && (
                <Button
                  onClick={handleResumeAuction}
                  className="bg-blue-600 hover:bg-blue-700 h-11 px-4 sm:px-5 text-sm"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  View Results
                </Button>
              )}

              {/* Copy Auction Link - share the live auction viewer URL with
                  anyone who wants to watch. Shown whenever a room exists. */}
              {auctionRooms && auctionRooms.length > 0 && (
                <Button
                  onClick={handleCopyAuctionLink}
                  variant="outline"
                  className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white h-11 px-4 sm:px-5 text-sm"
                >
                  <Link2 className="w-4 h-4 mr-2" />
                  Copy Auction Link
                </Button>
              )}

              {/* Restart Auction Button - show when auction exists (active or completed) */}
              {isAdmin && auctionRooms && auctionRooms.length > 0 && (tournament.status === 'active' || tournament.status === 'completed') && (
                <Button
                  onClick={handleRestartAuction}
                  disabled={restarting}
                  variant="outline"
                  className="border-orange-600 text-orange-500 hover:bg-orange-600 hover:text-white h-11 px-4 sm:px-5 text-sm"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  {restarting ? 'Restarting...' : 'Restart Auction'}
                </Button>
              )}
            </div>
          </div>
        </div>



        {tournament.status === 'completed' && (
          <div className="mt-4 mb-4 bg-purple-600/10 border border-purple-600/30 rounded-lg p-4">
            <p className="text-sm text-purple-400">
              ✓ Tournament completed. Editing is disabled for completed tournaments.
            </p>
          </div>
        )}


        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 mb-6 sm:mb-8">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 sm:p-5 lg:p-6">
            <div className="flex items-center gap-2 sm:gap-3 mb-2">
              <div className="p-1.5 sm:p-2 bg-blue-500/20 rounded-lg">
                <Users className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
              </div>
              <span className="text-slate-400 text-xs sm:text-sm">Teams</span>
            </div>
            <div className="text-xl sm:text-2xl lg:text-3xl font-bold">{teams?.length || 0}</div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 sm:p-5 lg:p-6">
            <div className="flex items-center gap-2 sm:gap-3 mb-2">
              <div className="p-1.5 sm:p-2 bg-green-500/20 rounded-lg">
                <UserPlus className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
              </div>
              <span className="text-slate-400 text-xs sm:text-sm">Total Players</span>
            </div>
            <div className="text-xl sm:text-2xl lg:text-3xl font-bold">{playerCount}</div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 sm:p-5 lg:p-6">
            <div className="flex items-center gap-2 sm:gap-3 mb-2">
              <div className="p-1.5 sm:p-2 bg-yellow-500/20 rounded-lg">
                <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-500" />
              </div>
              <span className="text-slate-400 text-xs sm:text-sm">Pending</span>
            </div>
            <div className="text-xl sm:text-2xl lg:text-3xl font-bold">{pendingPlayers}</div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 sm:p-5 lg:p-6">
            <div className="flex items-center gap-2 sm:gap-3 mb-2">
              <div className="p-1.5 sm:p-2 bg-purple-500/20 rounded-lg">
                <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-purple-500" />
              </div>
              <span className="text-slate-400 text-xs sm:text-sm">Sold</span>
            </div>
            <div className="text-xl sm:text-2xl lg:text-3xl font-bold">{soldPlayers}</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-6">
          <Link href={`/tournament/${tournamentId}/teams`}>
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 sm:p-6 lg:p-8 hover:border-blue-500 active:scale-[0.98] transition cursor-pointer group">
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <div className="p-2.5 sm:p-3 bg-blue-500/20 rounded-xl">
                  <Users className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 text-blue-500 group-hover:scale-110 transition" />
                </div>
                <span className="text-2xl sm:text-3xl font-bold text-blue-400">{teams?.length || 0}</span>
              </div>
              <h3 className="text-lg sm:text-xl lg:text-2xl font-bold mb-2">{isAdmin ? 'Manage Teams' : 'View Teams'}</h3>
              <p className="text-slate-400 mb-3 sm:mb-4 text-sm sm:text-base">
                Add, edit, and organize your tournament teams
              </p>
              <div className="flex items-center gap-2 text-blue-400 text-sm sm:text-base font-medium">
                <span>{isAdmin ? 'Manage Teams' : 'View Teams'}</span>
                <ArrowLeft className="w-4 h-4 rotate-180" />
              </div>
            </div>
          </Link>

          <Link href={`/tournament/${tournamentId}/players`}>
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 sm:p-6 lg:p-8 hover:border-green-500 active:scale-[0.98] transition cursor-pointer group">
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <div className="p-2.5 sm:p-3 bg-green-500/20 rounded-xl">
                  <UserPlus className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 text-green-500 group-hover:scale-110 transition" />
                </div>
                <span className="text-2xl sm:text-3xl font-bold text-green-400">{playerCount}</span>
              </div>
              <h3 className="text-lg sm:text-xl lg:text-2xl font-bold mb-2">{isAdmin ? 'Manage Players' : 'View Players'}</h3>
              <p className="text-slate-400 mb-3 sm:mb-4 text-sm sm:text-base">
                Add players, import from Excel, set base prices
              </p>
              <div className="flex items-center gap-2 text-green-400 text-sm sm:text-base font-medium">
                <span>{isAdmin ? 'Manage Players' : 'View Players'}</span>
                <ArrowLeft className="w-4 h-4 rotate-180" />
              </div>
            </div>
          </Link>


          <Link href={`/tournament/${tournamentId}/groups`}>
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 sm:p-6 lg:p-8 hover:border-purple-500 active:scale-[0.98] transition cursor-pointer group">
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <div className="p-2.5 sm:p-3 bg-purple-500/20 rounded-xl">
                  <Layers className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 text-purple-500 group-hover:scale-110 transition" />
                </div>
                <span className="text-lg sm:text-xl font-bold text-purple-400">
                  {groupDraw
                    ? `${groupDraw.numGroups} group${groupDraw.numGroups !== 1 ? 's' : ''}`
                    : 'Not drawn'}
                </span>
              </div>
              <h3 className="text-lg sm:text-xl lg:text-2xl font-bold mb-2">Group Draw</h3>
              <p className="text-slate-400 mb-3 sm:mb-4 text-sm sm:text-base">
                Randomly allot teams to groups with a live draw
              </p>
              <div className="flex items-center gap-2 text-purple-400 text-sm sm:text-base font-medium">
                <span>{groupDraw ? 'View Groups' : 'Run Group Draw'}</span>
                <ArrowLeft className="w-4 h-4 rotate-180" />
              </div>
            </div>
          </Link>

          {/* Uncomment and use if you want the stats card */}
          {/*
        <Link href={`/tournament/${tournamentId}/stats`}>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 hover:border-purple-500 transition cursor-pointer group">
            <Trophy className="w-12 h-12 text-purple-500 mb-4 group-hover:scale-110 transition" />
            <h3 className="text-2xl font-bold mb-2">View Statistics</h3>
            <p className="text-slate-400 mb-4">
              Analyze auction results and team compositions
            </p>
            <div className="flex items-center gap-2 text-purple-400">
              <span>View Stats</span>
              <ArrowLeft className="w-4 h-4 rotate-180" />
            </div>
          </div>
        </Link>
        */}
        </div>

        {/* Tournament Settings Summary */}
        <div className="mt-6 sm:mt-8 bg-slate-800/50 border border-slate-700 rounded-xl p-4 sm:p-5 lg:p-6">
          <h2 className="text-lg sm:text-xl font-bold mb-4">Tournament Settings</h2>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            <div>
              <span className="text-slate-400 text-xs sm:text-sm">Base Purse per Team</span>
              <div className="text-lg sm:text-xl font-bold text-green-400">
                {formatCurrency(tournament.settings.basePurse)}
              </div>
            </div>
            <div>
              <span className="text-slate-400 text-xs sm:text-sm">Minimum Bid Increment</span>
              <div className="text-lg sm:text-xl font-bold">
                {formatCurrency(tournament.settings.minBidIncrement)}
              </div>
            </div>
            <div>
              <span className="text-slate-400 text-xs sm:text-sm">Bid Timer</span>
              <div className="text-lg sm:text-xl font-bold">
                {tournament.settings.bidTimerSeconds}s
              </div>
            </div>
            <div>
              <span className="text-slate-400 text-xs sm:text-sm">Max Players per Team</span>
              <div className="text-lg sm:text-xl font-bold">
                {tournament.settings.maxPlayersPerTeam}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <TournamentSettingsModal
          tournamentId={tournamentId}
          currentSettings={{
            name: tournament.name,
            description: tournament.description,
            logoUrl: tournament.logoUrl,
            settings: tournament.settings,
            status: tournament.status,
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}