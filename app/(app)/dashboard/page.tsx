"use client";

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import Link from 'next/link';
import { Plus, Trophy, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { useUser } from '@clerk/nextjs';
import { redirect } from 'next/navigation';

// Cricket Ball SVG Component
function CricketBall({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className}>
      <circle cx="50" cy="50" r="45" fill="#DC2626" />
      <path d="M20 50 Q35 30, 50 50 Q65 70, 80 50" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 50 Q35 70, 50 50 Q65 30, 80 50" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <g stroke="white" strokeWidth="1.5" strokeLinecap="round">
        <line x1="25" y1="42" x2="28" y2="38" /><line x1="32" y1="36" x2="35" y2="32" />
        <line x1="40" y1="34" x2="43" y2="30" /><line x1="57" y1="30" x2="60" y2="34" />
        <line x1="65" y1="32" x2="68" y2="36" /><line x1="72" y1="38" x2="75" y2="42" />
        <line x1="25" y1="58" x2="28" y2="62" /><line x1="32" y1="64" x2="35" y2="68" />
        <line x1="40" y1="66" x2="43" y2="70" /><line x1="57" y1="70" x2="60" y2="66" />
        <line x1="65" y1="68" x2="68" y2="64" /><line x1="72" y1="62" x2="75" y2="58" />
      </g>
    </svg>
  );
}

export default function DashboardPage() {
  const { isSignedIn, isLoaded } = useUser();
  // Organisers (anyone on a tournament's staff) see their own tournaments;
  // everyone else sees the active ones. Anyone signed in can create one.
  const myTournaments = useQuery(api.tournaments.listMine, {});
  const allTournaments = useQuery(api.tournaments.listAll, {});
  const isRoleLoading = myTournaments === undefined;
  const isOrganiser = (myTournaments?.length ?? 0) > 0;
  const tournaments = isOrganiser ? myTournaments : allTournaments;

  // Redirect if not signed in
  if (isLoaded && !isSignedIn) {
    redirect('/sign-in');
  }

  if (!isLoaded || isRoleLoading) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white relative overflow-hidden">
      {/* Cricket-themed Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-linear-to-t from-green-900/15 to-transparent" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-yellow-500/5 rounded-full blur-3xl" />
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl" />
        <CricketBall className="absolute top-20 right-10 w-10 h-10 opacity-10 animate-bounce" />
        <CricketBall className="absolute bottom-40 left-10 w-6 h-6 opacity-10" />
      </div>

      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 safe-bottom relative z-10">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2">
            <span className="bg-clip-text text-transparent bg-linear-to-r from-red-500 via-orange-400 to-yellow-500">
              Dashboard
            </span>
          </h1>
          <p className="text-slate-400 text-sm sm:text-base">Manage your cricket auction tournaments</p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5 lg:gap-6 mb-6 sm:mb-8">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 sm:p-5 lg:p-6 hover:border-yellow-500/50 transition group">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-yellow-500/20 rounded-lg group-hover:scale-110 transition">
                <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-500" />
              </div>
              <span className="text-slate-400 text-sm sm:text-base">Total Tournaments</span>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-yellow-500">{tournaments?.length || 0}</div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 sm:p-5 lg:p-6 hover:border-green-500/50 transition group">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-green-500/20 rounded-lg group-hover:scale-110 transition">
                <Users className="w-5 h-5 sm:w-6 sm:h-6 text-green-500" />
              </div>
              <span className="text-slate-400 text-sm sm:text-base">Active Auctions</span>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-green-500">
              {tournaments?.filter(t => t.status === 'active').length || 0}
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 sm:p-5 lg:p-6 hover:border-red-500/50 transition group">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-red-500/20 rounded-lg group-hover:scale-110 transition">
                <CricketBall className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <span className="text-slate-400 text-sm sm:text-base">Completed</span>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-red-500">
              {tournaments?.filter(t => t.status === 'completed').length || 0}
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="mb-5 sm:mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-xl sm:text-2xl font-bold">
            {isOrganiser ? 'My Tournaments' : 'Active Tournaments'}
          </h2>
          <Link href="/tournament/create">
            <Button size="lg" className="h-12 px-5 sm:px-6 text-base w-full sm:w-auto bg-linear-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600">
              <Plus className="w-5 h-5 mr-2" />
              New Tournament
            </Button>
          </Link>
        </div>

        {/* Tournaments List */}
        {!tournaments ? (
          <div className="flex items-center justify-center py-16 sm:py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500" />
          </div>
        ) : tournaments.length === 0 ? (
          <div className="text-center py-12 sm:py-16 lg:py-20 px-4">
            <CricketBall className="w-16 sm:w-20 h-16 sm:h-20 mx-auto mb-4 opacity-30" />
            <h3 className="text-lg sm:text-xl font-semibold mb-2">No tournaments yet</h3>
            <p className="text-slate-400 mb-6 text-sm sm:text-base">
              Create your first tournament and experience IPL-style auctions
            </p>
            <Link href="/tournament/create">
              <Button size="lg" className="h-12 px-6 text-base bg-linear-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600">
                <Plus className="w-5 h-5 mr-2" />
                Create Tournament
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-6">
            {tournaments.map((tournament) => (
              <Link 
                key={tournament._id} 
                href={`/tournament/${tournament._id}`}
              >
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 sm:p-5 lg:p-6 hover:border-orange-500/50 active:scale-[0.98] transition cursor-pointer group">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3 flex-1">
                      {/* Tournament Logo */}
                      {tournament.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img 
                          src={tournament.logoUrl} 
                          alt={`${tournament.name} logo`}
                          className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg object-cover border border-slate-600 group-hover:border-orange-500/50 transition"
                        />
                      ) : (
                        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-linear-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center group-hover:scale-105 transition">
                          <CricketBall className="w-6 h-6 sm:w-7 sm:h-7" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base sm:text-lg font-bold mb-1 group-hover:text-orange-400 transition truncate">
                          {tournament.name}
                        </h3>
                        {tournament.description && (
                          <p className="text-xs sm:text-sm text-slate-400 line-clamp-1">
                            {tournament.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 ml-2">
                      <span className={`px-2.5 sm:px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                        tournament.status === 'active' ? 'bg-green-600' :
                        tournament.status === 'setup' ? 'bg-orange-600' :
                        tournament.status === 'completed' ? 'bg-red-600' :
                        'bg-slate-600'
                      }`}>
                        {tournament.status}
                      </span>
                      {tournament.isActive === false && (
                        <span className="px-2.5 sm:px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-amber-600/20 text-amber-400 border border-amber-600/40">
                          Inactive
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-slate-400">
                      <span>Base Purse</span>
                      <span className="font-semibold text-green-400">
                        ₹{(tournament.settings.basePurse / 100000).toFixed(1)}L
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
                    <span className="text-orange-400 group-hover:underline font-medium">
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