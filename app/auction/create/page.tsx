"use client";

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Play, Trophy } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { getCaptainPlayerIds } from '@/lib/utils';

function CreateAuctionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tournamentId = searchParams.get('tournamentId') as Id<"tournaments"> | null;

  const tournament = useQuery(
    api.tournaments.getById, 
    tournamentId ? { id: tournamentId } : "skip"
  );
  const teams = useQuery(
    api.teams.listByTournament,
    tournamentId ? { tournamentId } : "skip"
  );
  const players = useQuery(
    api.players.listByTournament,
    tournamentId ? { tournamentId } : "skip"
  );

  const createAuctionRoom = useMutation(api.auctions.createAuctionRoom);

  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  // Captains are pre-assigned and never auctioned — exclude them from the
  // player counts and start-auction validation shown on this page.
  const captainPlayerIds = getCaptainPlayerIds(teams);
  const auctionablePlayers = (players ?? []).filter(p => !captainPlayerIds.has(p._id));

  useEffect(() => {
    if (tournament) {
      setName(`${tournament.name} - Live Auction`);
    }
  }, [tournament]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!tournamentId) {
      toast.error('No tournament selected');
      return;
    }

    if (!teams || teams.length < 2) {
      toast.error('You need at least 2 teams to start an auction');
      return;
    }

    if (auctionablePlayers.length === 0) {
      toast.error('You need to add players before starting');
      return;
    }

    setLoading(true);

    try {
      const auctionRoomId = await createAuctionRoom({
        tournamentId,
        name,
      });

      toast.success('Auction room created!');
      router.push(`/auction/${auctionRoomId}`);
    } catch (error) {
      toast.error('Failed to create auction', { 
        description: (error as Error).message 
      });
    } finally {
      setLoading(false);
    }
  };

  if (!tournamentId) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
        <Navbar />
        <main className="max-w-2xl mx-auto px-6 py-8">
          <div className="text-center py-20">
            <Trophy className="w-20 h-20 mx-auto mb-4 text-slate-700" />
            <h2 className="text-2xl font-bold mb-2">No Tournament Selected</h2>
            <p className="text-slate-400 mb-6">
              Please select a tournament to create an auction.
            </p>
            <Link href="/dashboard">
              <Button>Go to Dashboard</Button>
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const pendingPlayers = auctionablePlayers.filter(p => p.auctionStatus === 'pending').length;

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Navbar />

      <main className="max-w-2xl mx-auto px-6 py-8">
        <Link 
          href={`/tournament/${tournamentId}`} 
          className="flex items-center gap-2 text-slate-400 hover:text-white transition mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Tournament
        </Link>

        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <Play className="w-10 h-10 text-green-500" />
            <div>
              <h1 className="text-3xl font-bold">Start Auction</h1>
              <p className="text-slate-400">Create a live auction room</p>
            </div>
          </div>

          {/* Tournament Info */}
          <div className="bg-slate-900/50 rounded-lg p-4 mb-6">
            <h3 className="font-semibold mb-3">Tournament Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-slate-400">Name:</span>
                <span className="ml-2 font-medium">{tournament?.name}</span>
              </div>
              <div>
                <span className="text-slate-400">Teams:</span>
                <span className="ml-2 font-medium">{teams?.length || 0}</span>
              </div>
              <div>
                <span className="text-slate-400">Total Players:</span>
                <span className="ml-2 font-medium">{auctionablePlayers.length}</span>
              </div>
              <div>
                <span className="text-slate-400">Pending:</span>
                <span className="ml-2 font-medium text-yellow-400">{pendingPlayers}</span>
              </div>
            </div>
          </div>

          {/* Validation Warnings */}
          {teams && teams.length < 2 && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-6">
              <p className="text-red-400 text-sm">
                ⚠️ You need at least 2 teams to start an auction.
              </p>
            </div>
          )}

          {players && auctionablePlayers.length === 0 && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-6">
              <p className="text-red-400 text-sm">
                ⚠️ You need to add players before starting an auction.
              </p>
            </div>
          )}

          {pendingPlayers === 0 && auctionablePlayers.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-4 mb-6">
              <p className="text-yellow-400 text-sm">
                ⚠️ No pending players. All players have been auctioned.
              </p>
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-6">
            <div>
              <Label htmlFor="name">Auction Room Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., IPL 2026 - Live Auction"
                className="mt-2"
                required
              />
            </div>

            <div className="flex gap-3">
              <Link href={`/tournament/${tournamentId}`} className="flex-1">
                <Button type="button" variant="outline" className="w-full">
                  Cancel
                </Button>
              </Link>
              <Button 
                type="submit" 
                disabled={loading || !teams || teams.length < 2 || auctionablePlayers.length === 0}
                className="flex-1"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Start Auction
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
        </div>
      </main>
    </div>
  );
}

export default function CreateAuctionPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <CreateAuctionContent />
    </Suspense>
  );
}
