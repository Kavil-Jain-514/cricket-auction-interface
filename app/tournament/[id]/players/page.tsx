"use client";

import { use } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import Link from 'next/link';
import { ArrowLeft, Plus, Upload, Users, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { PlayerCard } from '@/components/players/PlayerCard';
import { PlayerImport } from '@/components/players/PlayerImport';
import { PlayerForm } from '@/components/players/PlayerForm';
import { useState } from 'react';
import { toast } from 'sonner';

export default function PlayersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tournamentId = id as Id<"tournaments">;
  const [showImport, setShowImport] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [filterRole, setFilterRole] = useState<string>('all');
  type StatusFilter = 'all' | 'pending' | 'in_auction' | 'sold' | 'unsold';
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });
  const allPlayers = useQuery(api.players.listByTournament, { tournamentId });
  const deleteAllPlayers = useMutation(api.players.deleteAllByTournament);

  const players = allPlayers?.filter(p => 
    {const statusMatch = filterStatus === 'all' || p.auctionStatus === filterStatus;
    const roleMatch = filterRole === 'all' || p.role === filterRole;
    return statusMatch && roleMatch;}
  );

  const stats = {
    total: allPlayers?.length || 0,
    pending: allPlayers?.filter(p => p.auctionStatus === 'pending').length || 0,
    inAuction: allPlayers?.filter(p => p.auctionStatus === 'in_auction').length || 0,
    sold: allPlayers?.filter(p => p.auctionStatus === 'sold').length || 0,
    unsold: allPlayers?.filter(p => p.auctionStatus === 'unsold').length || 0,
    batters: allPlayers?.filter(p => p.role === 'Batter').length || 0,
    bowlers: allPlayers?.filter(p => p.role === 'Bowler').length || 0,
    allRounders: allPlayers?.filter(p => p.role === 'All-Rounder').length || 0,
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Navbar />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link href={`/tournament/${tournamentId}`} className="flex items-center gap-2 text-slate-400 hover:text-white transition mb-4">
            <ArrowLeft className="w-5 h-5" />
            Back to Tournament
          </Link>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Player Management</h1>
              <p className="text-slate-400">{tournament?.name}</p>
            </div>

            <div className="flex gap-3">
              {stats.total > 0 && (
                <Button 
                  variant="outline" 
                  onClick={() => setShowDeleteConfirm(true)}
                  className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete All
                </Button>
              )}
              <Button variant="outline" onClick={() => setShowImport(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Import Excel
              </Button>
              <Button onClick={() => setShowAddForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Player
              </Button>
            </div>
          </div>
        </div>

        {/* Filters */}
        {/* <div className="flex items-center gap-3 mb-6">
          <Filter className="w-5 h-5 text-slate-400" />
          <div className="flex gap-2">
            {['all', 'Batter', 'Bowler', 'All-Rounder'].map((role) => (
              <button
                key={role}
                onClick={() => setFilterRole(role)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  filterRole === role
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {role === 'all' ? 'All Players' : role}
              </button>
            ))}
          </div>
        </div> */}

      {/* Stats - Status Based */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Status Filters */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400 mr-1">Status:</span>
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                filterStatus === 'all' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              All ({stats.total})
            </button>
            <button
              onClick={() => setFilterStatus('pending')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                filterStatus === 'pending' 
                  ? 'bg-slate-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              Pending ({stats.pending})
            </button>
            <button
              onClick={() => setFilterStatus('in_auction')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                filterStatus === 'in_auction' 
                  ? 'bg-yellow-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              In Auction ({stats.inAuction})
            </button>
            <button
              onClick={() => setFilterStatus('sold')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                filterStatus === 'sold' 
                  ? 'bg-green-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              Sold ({stats.sold})
            </button>
            <button
              onClick={() => setFilterStatus('unsold')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                filterStatus === 'unsold' 
                  ? 'bg-red-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              Unsold ({stats.unsold})
            </button>
          </div>

          <div className="h-6 w-px bg-slate-700" />

          {/* Role Filters */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400 mr-1">Role:</span>
            <button
              onClick={() => setFilterRole(filterRole === 'all' ? 'all' : 'all')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                filterRole === 'all' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
              // Hide this if already showing all
              style={{ display: filterRole === 'all' ? 'none' : 'block' }}
            >
              All
            </button>
            <button
              onClick={() => setFilterRole(filterRole === 'Batter' ? 'all' : 'Batter')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                filterRole === 'Batter' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              Batters ({stats.batters})
            </button>
            <button
              onClick={() => setFilterRole(filterRole === 'Bowler' ? 'all' : 'Bowler')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                filterRole === 'Bowler' 
                  ? 'bg-red-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              Bowlers ({stats.bowlers})
            </button>
            <button
              onClick={() => setFilterRole(filterRole === 'All-Rounder' ? 'all' : 'All-Rounder')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                filterRole === 'All-Rounder' 
                  ? 'bg-purple-600 text-white' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              All-Rounders ({stats.allRounders})
            </button>
          </div>

          {/* Clear Filters */}
          {(filterStatus !== 'all' || filterRole !== 'all') && (
            <>
              <div className="h-6 w-px bg-slate-700" />
              <button
                onClick={() => {
                  setFilterStatus('all');
                  setFilterRole('all');
                }}
                className="px-3 py-1.5 rounded-full text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition"
              >
                Clear Filters
              </button>
            </>
          )}
        </div>

        {/* Players Grid */}
        {!players ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
          </div>
        ) : players.length === 0 ? (
          <div className="text-center py-20">
            <Users className="w-20 h-20 mx-auto mb-4 text-slate-700" />
            <h3 className="text-xl font-semibold mb-2">No players yet</h3>
            <p className="text-slate-400 mb-6">
              {filterRole === 'all' 
                ? 'Add players or import from Excel to get started'
                : `No ${filterRole}s found. Try a different filter.`
              }
            </p>
            {filterRole === 'all' && (
              <div className="flex gap-3 justify-center">
                <Button onClick={() => setShowImport(true)} variant="outline">
                  <Upload className="w-5 h-5 mr-2" />
                  Import from Excel
                </Button>
                <Button onClick={() => setShowAddForm(true)}>
                  <Plus className="w-5 h-5 mr-2" />
                  Add First Player
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {players.map((player) => (
              <PlayerCard key={player._id} player={player} />
            ))}
          </div>
        )}

        {/* Import Modal */}
        {showImport && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-4xl w-full p-6 my-8">
              <PlayerImport
                tournamentId={tournamentId}
                onComplete={() => setShowImport(false)}
              />
            </div>
          </div>
        )}

        {/* Add Player Form */}
        {showAddForm && (
          <PlayerForm
            tournamentId={tournamentId}
            onClose={() => setShowAddForm(false)}
          />
        )}

        {/* Delete All Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-red-500/20 rounded-full">
                  <AlertTriangle className="w-6 h-6 text-red-500" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Delete All Players</h3>
                  <p className="text-slate-400 text-sm">This action cannot be undone</p>
                </div>
              </div>

              <div className="bg-slate-800/50 rounded-lg p-4 mb-6">
                <p className="text-slate-300 mb-3">
                  Are you sure you want to delete all players from this tournament?
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total players:</span>
                    <span className="font-semibold">{stats.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Pending (will be deleted):</span>
                    <span className="font-semibold text-red-400">{stats.pending}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Unsold (will be deleted):</span>
                    <span className="font-semibold text-red-400">{stats.unsold}</span>
                  </div>
                  {stats.sold > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Sold (will be skipped):</span>
                      <span className="font-semibold text-green-400">{stats.sold}</span>
                    </div>
                  )}
                  {stats.inAuction > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">In auction (will be skipped):</span>
                      <span className="font-semibold text-yellow-400">{stats.inAuction}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button 
                  className="flex-1 bg-red-600 hover:bg-red-700"
                  disabled={isDeleting}
                  onClick={async () => {
                    setIsDeleting(true);
                    try {
                      const result = await deleteAllPlayers({ 
                        tournamentId,
                        includesSold: false,
                      });
                      toast.success(`Deleted ${result.deletedCount} players`, {
                        description: result.skippedCount > 0 
                          ? `${result.skippedCount} players were skipped (sold/in auction)`
                          : undefined,
                      });
                      setShowDeleteConfirm(false);
                    } catch (error) {
                      toast.error('Failed to delete players', {
                        description: error instanceof Error ? error.message : 'Unknown error',
                      });
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                >
                  {isDeleting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete All
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}