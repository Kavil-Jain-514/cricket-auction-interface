"use client";

import { use } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import Link from 'next/link';
import { ArrowLeft, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { TeamCard } from '@/components/teams/TeamCard';
import { TeamForm } from '@/components/teams/TeamForm';
import { useState } from 'react';

export default function TeamsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tournamentId = id as Id<"tournaments">;
  const [showAddForm, setShowAddForm] = useState(false);
  
  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });
  const teams = useQuery(api.teams.listByTournament, { tournamentId });

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
              <h1 className="text-3xl font-bold mb-2">Team Management</h1>
              <p className="text-slate-400">{tournament?.name}</p>
            </div>

            <Button onClick={() => setShowAddForm(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Team
            </Button>
          </div>
        </div>

        {/* Teams Grid */}
        {!teams ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
          </div>
        ) : teams.length === 0 ? (
          <div className="text-center py-20">
            <Users className="w-20 h-20 mx-auto mb-4 text-slate-700" />
            <h3 className="text-xl font-semibold mb-2">No teams yet</h3>
            <p className="text-slate-400 mb-6">
              Add your first team to get started
            </p>
            <Button onClick={() => setShowAddForm(true)}>
              <Plus className="w-5 h-5 mr-2" />
              Add First Team
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {teams.map((team) => (
              <TeamCard key={team._id} team={team} tournamentId={tournamentId} />
            ))}
          </div>
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