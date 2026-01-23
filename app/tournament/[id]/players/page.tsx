"use client";

import { use } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import Link from 'next/link';
import { ArrowLeft, Plus, Upload, Users, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { PlayerCard } from '@/components/players/PlayerCard';
import { PlayerImport } from '@/components/players/PlayerImport';
import { PlayerForm } from '@/components/players/PlayerForm';
import { useState } from 'react';

export default function PlayersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tournamentId = id as Id<"tournaments">;
  const [showImport, setShowImport] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [filterRole, setFilterRole] = useState<string>('all');
  
  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });
  const allPlayers = useQuery(api.players.listByTournament, { tournamentId });

  const players = allPlayers?.filter(p => 
    filterRole === 'all' || p.role === filterRole
  );

  const stats = {
    total: allPlayers?.length || 0,
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

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-1">Total</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-1">Batters</div>
            <div className="text-2xl font-bold text-blue-400">{stats.batters}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-1">Bowlers</div>
            <div className="text-2xl font-bold text-red-400">{stats.bowlers}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-1">All-Rounders</div>
            <div className="text-2xl font-bold text-purple-400">{stats.allRounders}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
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
      </main>
    </div>
  );
}