"use client";

import { use, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import Link from 'next/link';
import { ArrowLeft, Plus, Users, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { TeamCard } from '@/components/teams/TeamCard';
import { TeamForm } from '@/components/teams/TeamForm';
import { TeamRequestsPanel } from '@/components/teams/TeamRequestsPanel';
import { useTournamentRole } from '@/hooks/useTournamentRole';

export default function TeamsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tournamentId = id as Id<"tournaments">;
  const [showAddForm, setShowAddForm] = useState(false);
  const { canManage } = useTournamentRole(tournamentId);
  
  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });
  const teams = useQuery(api.teams.listByTournament, { tournamentId });
  const auctionRooms = useQuery(api.auctions.getAuctionRooms, { tournamentId });
  // `undefined` while the query loads so cards keep delete gated until we
  // positively know whether an auction is live.
  const isAuctionLive = auctionRooms === undefined
    ? undefined
    : auctionRooms.some((room) => room.status === "live");

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
              <h1 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2">Team Management</h1>
              <p className="text-slate-400 text-sm sm:text-base">{tournament?.name}</p>
            </div>

            <div className="flex flex-wrap gap-2 sm:gap-3">
              {/* Viewer Mode Indicator */}
              {!canManage && (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/60 rounded-lg border border-slate-700 min-h-11">
                  <Eye className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-slate-300">Viewer Mode</span>
                </div>
              )}
              
              {canManage && (
                <Button onClick={() => setShowAddForm(true)} className="min-h-11 touch-target w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Team
                </Button>
              )}
            </div>
          </div>
        </div>

        {canManage && <TeamRequestsPanel tournamentId={tournamentId} />}

        {/* Teams Grid */}
        {!teams ? (
          <div className="flex items-center justify-center py-16 sm:py-20">
            <div className="animate-spin rounded-full h-10 w-10 sm:h-12 sm:w-12 border-b-2 border-blue-500" />
          </div>
        ) : teams.length === 0 ? (
          <div className="text-center py-16 sm:py-20 px-4">
            <Users className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 text-slate-700" />
            <h3 className="text-lg sm:text-xl font-semibold mb-2">No teams yet</h3>
            <p className="text-slate-400 mb-6 text-sm sm:text-base">
              Add your first team to get started
            </p>
            {canManage && (
              <Button onClick={() => setShowAddForm(true)} className="min-h-11 touch-target">
                <Plus className="w-5 h-5 mr-2" />
                Add First Team
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-400 mb-4">
              <span className="hidden sm:inline">{teams.length} team{teams.length !== 1 ? 's' : ''}</span>
              <span className="sm:hidden">{teams.length} team{teams.length !== 1 ? 's' : ''}</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {teams.map((team) => (
                <TeamCard key={team._id} team={team} tournamentId={tournamentId} isAuctionLive={isAuctionLive} />
              ))}
            </div>
          </>
        )}

        {/* Add Team Form Modal */}
        {showAddForm && (
          <TeamForm
            tournamentId={tournamentId}
            onClose={() => setShowAddForm(false)}
          />
        )}
      </main>
    </div>
  );
}