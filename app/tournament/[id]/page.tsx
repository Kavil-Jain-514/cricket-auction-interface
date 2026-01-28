"use client";

import { use, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import Link from 'next/link';
import { ArrowLeft, Users, UserPlus, Trophy, Settings, Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { TournamentSettingsModal } from '@/components/tournament/TournamentSettingsModal';

export default function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const tournamentId = id as Id<"tournaments">;
  const [showSettings, setShowSettings] = useState(false);
  
  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });
  const teams = useQuery(api.teams.listByTournament, { tournamentId });
  const players = useQuery(api.players.listByTournament, { tournamentId });
  const updateTournament = useMutation(api.tournaments.update);
  const canModify = useQuery(api.tournaments.canModify, { id: tournamentId });
  const deleteTournament = useMutation(api.tournaments.deleteTournament);

  const [deleting, setDeleting] = useState(false);
  const auctionRooms = useQuery(api.auctions.getAuctionRooms, { tournamentId });

  const canResumeAuction = () => 
    {
      if (!tournament || !players) return false;
    
      // Check if tournament is active or has pending players
      const hasPendingPlayers = players.some(p => p.auctionStatus === 'pending');
      const isActive = tournament.status === 'active';
    
      return (isActive || hasPendingPlayers) && auctionRooms && auctionRooms.length > 0;
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
  
  const handleStartAuction = async () => {
    if (!teams || teams.length < 2) {
      toast.error('You need at least 2 teams to start an auction');
      return;
    }
    if (!players || players.length === 0) {
      toast.error('You need to add players before starting');
      return;
    }

    try {
      await updateTournament({
        id: tournamentId,
        status: 'active',
      });
      router.push(`/auction/create?tournamentId=${tournamentId}`);
    } catch (error) {
      toast.error('Failed to start auction', { description: (error as Error).message });
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${tournament?.name}"? This will delete all teams, players, and auction data. This action cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      await deleteTournament({ id: tournamentId });
      toast.success('Tournament deleted successfully');
      router.push('/dashboard');
    } catch (error) {
      toast.error(error.message || 'Failed to delete tournament');
      setDeleting(false);
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

  const pendingPlayers = players?.filter(p => p.auctionStatus === 'pending').length || 0;
  const soldPlayers = players?.filter(p => p.auctionStatus === 'sold').length || 0;

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Navbar />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link href="/dashboard" className="flex items-center gap-2 text-slate-400 hover:text-white transition mb-4">
            <ArrowLeft className="w-5 h-5" />
            Back to Dashboard
          </Link>

          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-4 mb-2">
                {/* Tournament Logo */}
                {tournament.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img 
                    src={tournament.logoUrl} 
                    alt={`${tournament.name} logo`}
                    className="w-16 h-16 rounded-xl object-cover border border-slate-600"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                    <Trophy className="w-10 h-10 text-yellow-500" />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-4xl font-bold">{tournament.name}</h1>
                    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                      tournament.status === 'active' ? 'bg-green-600' :
                      tournament.status === 'setup' ? 'bg-blue-600' :
                      tournament.status === 'completed' ? 'bg-purple-600' :
                      'bg-slate-600'
                    }`}>
                      {tournament.status}
                    </span>
                  </div>
                  {tournament.description && (
                    <p className="text-slate-400 mt-1">{tournament.description}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              {canModify?.canEdit && (
              <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Button>
              )}

              {canModify?.canDelete && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="border-red-600 text-red-600 hover:bg-red-600 hover:text-white"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
              )}

              <Button 
                onClick={handleStartAuction}
                disabled={tournament.status === 'active' || tournament.status === 'completed'}
              >
                <Play className="w-4 h-4 mr-2" />
                Start Auction
              </Button>
              {canResumeAuction() && (
                <Button 
                  onClick={handleResumeAuction}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Resume Auction
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Warning Messages */}
        {tournament.status === 'active' && (
          <div className="mt-4 mb-4 bg-yellow-600/10 border border-yellow-600/30 rounded-lg p-4 ">
            <p className="text-sm text-yellow-400">
              ⚠️ Tournament is active. Editing and deletion are disabled during auction.
            </p>
          </div>
        )}

        {tournament.status === 'completed' && (
          <div className="mt-4 mb-4 bg-purple-600/10 border border-purple-600/30 rounded-lg p-4">
            <p className="text-sm text-purple-400">
              ✓ Tournament completed. Editing is disabled for completed tournaments.
            </p>
          </div>
        )}


        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-5 h-5 text-blue-500" />
              <span className="text-slate-400 text-sm">Teams</span>
            </div>
            <div className="text-3xl font-bold">{teams?.length || 0}</div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <UserPlus className="w-5 h-5 text-green-500" />
              <span className="text-slate-400 text-sm">Total Players</span>
            </div>
            <div className="text-3xl font-bold">{players?.length || 0}</div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              <span className="text-slate-400 text-sm">Pending</span>
            </div>
            <div className="text-3xl font-bold">{pendingPlayers}</div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <Trophy className="w-5 h-5 text-purple-500" />
              <span className="text-slate-400 text-sm">Sold</span>
            </div>
            <div className="text-3xl font-bold">{soldPlayers}</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid md:grid-cols-2 gap-6">
          <Link href={`/tournament/${tournamentId}/teams`}>
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 hover:border-blue-500 transition cursor-pointer group">
              <Users className="w-12 h-12 text-blue-500 mb-4 group-hover:scale-110 transition" />
              <h3 className="text-2xl font-bold mb-2">Manage Teams</h3>
              <p className="text-slate-400 mb-4">
                Add, edit, and organize your tournament teams
              </p>
              <div className="flex items-center gap-2 text-blue-400">
                <span>Manage Teams</span>
                <ArrowLeft className="w-4 h-4 rotate-180" />
              </div>
            </div>
          </Link>

          <Link href={`/tournament/${tournamentId}/players`}>
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 hover:border-green-500 transition cursor-pointer group">
              <UserPlus className="w-12 h-12 text-green-500 mb-4 group-hover:scale-110 transition" />
              <h3 className="text-2xl font-bold mb-2">Manage Players</h3>
              <p className="text-slate-400 mb-4">
                Add players, import from Excel, set base prices
              </p>
              <div className="flex items-center gap-2 text-green-400">
                <span>Manage Players</span>
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
        <div className="mt-8 bg-slate-800/50 border border-slate-700 rounded-xl p-6">
          <h2 className="text-xl font-bold mb-4">Tournament Settings</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <span className="text-slate-400 text-sm">Base Purse per Team</span>
              <div className="text-xl font-bold text-green-400">
                {formatCurrency(tournament.settings.basePurse)}
              </div>
            </div>
            <div>
              <span className="text-slate-400 text-sm">Minimum Bid Increment</span>
              <div className="text-xl font-bold">
                {formatCurrency(tournament.settings.minBidIncrement)}
              </div>
            </div>
            <div>
              <span className="text-slate-400 text-sm">Bid Timer</span>
              <div className="text-xl font-bold">
                {tournament.settings.bidTimerSeconds}s
              </div>
            </div>
            <div>
              <span className="text-slate-400 text-sm">Max Players per Team</span>
              <div className="text-xl font-bold">
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
          }}
          onClose={() => setShowSettings(false)}
          onSuccess={() => {
            setShowSettings(false);
            toast.success('Tournament updated successfully');
          }}
        />
      )}
    </div>
  );
}