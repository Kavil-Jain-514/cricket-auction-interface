"use client";

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import Link from 'next/link';
import { Plus, Trophy, Users, Calendar, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { useUser } from '@clerk/nextjs';
import { redirect } from 'next/navigation';

export default function DashboardPage() {
  const { isSignedIn, isLoaded } = useUser();
  const tournaments = useQuery(api.tournaments.list);

  // Redirect if not signed in
  if (isLoaded && !isSignedIn) {
    redirect('/sign-in');
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Navbar />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Dashboard</h1>
          <p className="text-slate-400">Manage your cricket auction tournaments</p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              <span className="text-slate-400 text-sm">Total Tournaments</span>
            </div>
            <div className="text-3xl font-bold">{tournaments?.length || 0}</div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-5 h-5 text-blue-500" />
              <span className="text-slate-400 text-sm">Active Auctions</span>
            </div>
            <div className="text-3xl font-bold">
              {tournaments?.filter(t => t.status === 'active').length || 0}
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <TrendingUp className="w-5 h-5 text-purple-500" />
              <span className="text-slate-400 text-sm">Completed</span>
            </div>
            <div className="text-3xl font-bold">
              {tournaments?.filter(t => t.status === 'completed').length || 0}
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="mb-6 flex justify-between items-center">
          <h2 className="text-2xl font-bold">My Tournaments</h2>
          <Link href="/tournament/create">
            <Button size="lg">
              <Plus className="w-5 h-5 mr-2" />
              New Tournament
            </Button>
          </Link>
        </div>

        {/* Tournaments List */}
        {!tournaments ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
          </div>
        ) : tournaments.length === 0 ? (
          <div className="text-center py-20">
            <Trophy className="w-20 h-20 mx-auto mb-4 text-slate-700" />
            <h3 className="text-xl font-semibold mb-2">No tournaments yet</h3>
            <p className="text-slate-400 mb-6">
              Create your first tournament to get started
            </p>
            <Link href="/tournament/create">
              <Button size="lg">
                <Plus className="w-5 h-5 mr-2" />
                Create Tournament
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tournaments.map((tournament) => (
              <Link 
                key={tournament._id} 
                href={`/tournament/${tournament._id}`}
              >
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-blue-500 transition cursor-pointer group">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3 flex-1">
                      {/* Tournament Logo */}
                      {tournament.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img 
                          src={tournament.logoUrl} 
                          alt={`${tournament.name} logo`}
                          className="w-12 h-12 rounded-lg object-cover border border-slate-600"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                          <Trophy className="w-6 h-6 text-yellow-500" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold mb-1 group-hover:text-blue-400 transition truncate">
                          {tournament.name}
                        </h3>
                        {tournament.description && (
                          <p className="text-sm text-slate-400 line-clamp-1">
                            {tournament.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ml-2 ${
                      tournament.status === 'active' ? 'bg-green-600' :
                      tournament.status === 'setup' ? 'bg-blue-600' :
                      tournament.status === 'completed' ? 'bg-purple-600' :
                      'bg-slate-600'
                    }`}>
                      {tournament.status}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-slate-400">
                      <span>Base Purse</span>
                      <span className="font-semibold text-green-400">
                        ₹{(tournament.settings.basePurse / 100000).toFixed(1)}L
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Bid Timer</span>
                      <span className="font-semibold">
                        {tournament.settings.bidTimerSeconds}s
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Max Players</span>
                      <span className="font-semibold">
                        {tournament.settings.maxPlayersPerTeam}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-700 flex justify-between items-center text-xs text-slate-400">
                    <span>
                      Created {new Date(tournament.createdAt).toLocaleDateString()}
                    </span>
                    <span className="text-blue-400 group-hover:underline">
                      View Details →
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}