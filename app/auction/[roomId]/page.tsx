// app/auction/[roomId]/page.tsx
"use client";

import {use} from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, Pause, SkipForward, Trophy, 
  TrendingUp, Users, Timer, Gavel 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';

interface AuctionPageProps {
  params: Promise<{ roomId: string }>;
}

export default function AuctionPage({ params }: AuctionPageProps) {
    const { roomId } = use(params);
    const auctionRoomId = roomId as Id<"auctionRooms">;
  
  // Convex queries and mutations
  const auctionData = useQuery(api.auctions.getLiveAuction, { 
    auctionRoomId 
  });
  const placeBid = useMutation(api.auctions.placeBid);
  const finalizePlayer = useMutation(api.auctions.finalizePlayerSale);
  const startNext = useMutation(api.auctions.startNextPlayer);
  const startAuction = useMutation(api.auctions.startAuction);
  const pauseAuction = useMutation(api.auctions.pauseAuction);
  const resumeAuction = useMutation(api.auctions.resumeAuction);

  const [timeLeft, setTimeLeft] = useState(30);
  const [bidding, setBidding] = useState<Id<"teams"> | null>(null);

  // Calculate time left from server timestamp
  useEffect(() => {
    if (!auctionData?.auctionRoom?.bidTimerEndsAt) return;

    const updateTimer = () => {
      const remaining = Math.max(
        0, 
        Math.floor((auctionData.auctionRoom.bidTimerEndsAt! - Date.now()) / 1000)
      );
      setTimeLeft(remaining);

      // Auto-finalize when timer reaches 0
      if (remaining === 0 && auctionData.auctionRoom.status === 'live') {
        handleFinalize();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);
    return () => clearInterval(interval);
  }, [auctionData?.auctionRoom?.bidTimerEndsAt]);

  const handleBid = useCallback(async (teamId: Id<"teams">, amount: number) => {
    if (bidding) return;

    setBidding(teamId);
    try {
      await placeBid({ 
        auctionRoomId, 
        teamId, 
        amount 
      });
      
      // Play sound effect
      const audio = new Audio('/sounds/bid.mp3');
      audio.play().catch(() => {});
      
    } catch (error) {
      toast.error(error.message || "Failed to place bid");
    } finally {
      setBidding(null);
    }
  }, [placeBid, auctionRoomId, bidding]);

  const handleFinalize = useCallback(async () => {
    try {
      await finalizePlayer({ auctionRoomId });
      
      // Celebration effect if sold
      if (auctionData?.currentBidTeam) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
        
        const audio = new Audio('/sounds/sold.mp3');
        audio.play().catch(() => {});
      }
      
      toast.success(
        auctionData?.currentBidTeam 
          ? "Player sold!" 
          : "Player unsold"
      );
    } catch (error) {
      toast.error("Failed to finalize");
    }
  }, [finalizePlayer, auctionRoomId, auctionData]);

  const handleNextPlayer = useCallback(async () => {
    try {
      const result = await startNext({ auctionRoomId });
      
      if (result.completed) {
        toast.success("Auction completed!");
      } else {
        toast.success("Next player up!");
      }
    } catch (error) {
      toast.error("Failed to load next player");
    }
  }, [startNext, auctionRoomId]);

  if (!auctionData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  const { auctionRoom, currentPlayer, currentBidTeam, teams, recentBids } = auctionData;
  const currentBid = auctionRoom.currentBidAmount || currentPlayer?.basePrice || 0;
  const minNextBid = currentBid + (auctionData.tournament?.settings.minBidIncrement || 25000);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Header Controls */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Trophy className="w-8 h-8 text-yellow-500" />
              <div>
                <h1 className="text-2xl font-bold">
                  {auctionData.tournament?.name}
                </h1>
                <p className="text-sm text-slate-400">
                  {auctionRoom.status === 'waiting' && 'Waiting to start'}
                  {auctionRoom.status === 'live' && 'Live Auction'}
                  {auctionRoom.status === 'paused' && 'Auction Paused'}
                  {auctionRoom.status === 'completed' && 'Auction Completed'}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              {/* Start/Pause/Resume buttons based on status */}
              {auctionRoom.status === 'waiting' && (
                <Button
                  onClick={async () => {
                    try {
                      await startAuction({ auctionRoomId });
                      toast.success('Auction started!');
                    } catch (error) {
                      toast.error('Failed to start auction');
                    }
                  }}
                  variant="default"
                  size="lg"
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Play className="w-5 h-5 mr-2" />
                  Start Auction
                </Button>
              )}

              {auctionRoom.status === 'live' && (
                <Button
                  onClick={async () => {
                    try {
                      await pauseAuction({ auctionRoomId });
                      toast.info('Auction paused');
                    } catch (error) {
                      toast.error('Failed to pause auction');
                    }
                  }}
                  variant="outline"
                  size="lg"
                >
                  <Pause className="w-5 h-5 mr-2" />
                  Pause
                </Button>
              )}

              {auctionRoom.status === 'paused' && (
                <Button
                  onClick={async () => {
                    try {
                      await resumeAuction({ auctionRoomId });
                      toast.success('Auction resumed!');
                    } catch (error) {
                      toast.error('Failed to resume auction');
                    }
                  }}
                  variant="default"
                  size="lg"
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Play className="w-5 h-5 mr-2" />
                  Resume
                </Button>
              )}

              <Button
                onClick={handleFinalize}
                disabled={!currentPlayer || auctionRoom.status !== 'live'}
                variant="outline"
                size="lg"
              >
                <Gavel className="w-5 h-5 mr-2" />
                Finalize
              </Button>
              <Button
                onClick={handleNextPlayer}
                disabled={auctionRoom.currentPlayerId !== undefined || auctionRoom.status !== 'live'}
                size="lg"
              >
                <SkipForward className="w-5 h-5 mr-2" />
                Next Player
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-12 gap-6">
          {/* Teams Panel */}
          <aside className="col-span-3 space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Users className="w-5 h-5" />
              Teams
            </h3>
            
            {teams?.map((team) => {
              const isCurrentBidder = team._id === currentBidTeam?._id;
              const canBid = team.purseRemaining >= minNextBid;
              
              return (
                <motion.div
                  key={team._id}
                  whileHover={{ scale: canBid ? 1.02 : 1 }}
                  className={`
                    relative rounded-xl p-4 border-2 transition-all
                    ${isCurrentBidder 
                      ? 'border-yellow-500 bg-yellow-500/10 shadow-lg shadow-yellow-500/20' 
                      : 'border-slate-700 bg-slate-800/50'
                    }
                    ${canBid ? 'cursor-pointer hover:border-blue-500' : 'opacity-50'}
                  `}
                  onClick={() => 
                    canBid && currentPlayer && 
                    handleBid(team._id, minNextBid)
                  }
                >
                  {bidding === team._id && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
                    </div>
                  )}

                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: team.colorPrimary }}
                      />
                      <span className="font-semibold text-sm">
                        {team.name}
                      </span>
                    </div>
                    {isCurrentBidder && (
                      <Gavel className="w-4 h-4 text-yellow-500 animate-pulse" />
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Purse Left</span>
                      <span className="font-semibold text-green-400">
                        ₹{(team.purseRemaining / 100000).toFixed(1)}L
                      </span>
                    </div>
                    
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <motion.div
                        className="h-2 rounded-full"
                        style={{ backgroundColor: team.colorPrimary }}
                        initial={{ width: 0 }}
                        animate={{ 
                          width: `${(team.purseRemaining / (team.purseRemaining + team.purseSpent)) * 100}%` 
                        }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </aside>

          {/* Center Stage */}
          <div className="col-span-6">
            {/* Timer */}
            <div className="flex justify-center mb-8">
              <div className="relative">
                <svg className="w-32 h-32 transform -rotate-90">
                  <circle
                    cx="64"
                    cy="64"
                    r="58"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    className="text-slate-800"
                  />
                  <motion.circle
                    cx="64"
                    cy="64"
                    r="58"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    className={timeLeft <= 10 ? "text-red-500" : "text-blue-500"}
                    strokeDasharray="364"
                    strokeDashoffset={364 - (timeLeft / 30) * 364}
                    transition={{ duration: 1, ease: "linear" }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <motion.div 
                      className={`text-5xl font-bold ${
                        timeLeft <= 10 ? 'text-red-500' : 'text-blue-500'
                      }`}
                      animate={{ scale: timeLeft <= 5 ? [1, 1.1, 1] : 1 }}
                      transition={{ repeat: timeLeft <= 5 ? Infinity : 0, duration: 1 }}
                    >
                      {timeLeft}
                    </motion.div>
                    <div className="text-xs text-slate-400 mt-1">seconds</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Player Card */}
            <AnimatePresence mode="wait">
              {currentPlayer && (
                <motion.div
                  key={currentPlayer._id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-8 border border-slate-700 shadow-2xl"
                >
                  <div className="flex gap-6 mb-6">
                    <div className="w-48 h-48 bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center text-6xl font-bold">
                      {currentPlayer.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    
                    <div className="flex-1">
                      <h2 className="text-4xl font-bold mb-3">
                        {currentPlayer.name}
                      </h2>
                      
                      <div className="flex flex-wrap gap-2 mb-4">
                        <span className="px-4 py-2 bg-purple-600 rounded-full text-sm font-semibold">
                          {currentPlayer.role}
                        </span>
                        <span className="px-4 py-2 bg-slate-700 rounded-full text-sm">
                          {currentPlayer.age} years
                        </span>
                        <span className="px-4 py-2 bg-slate-700 rounded-full text-sm">
                          {currentPlayer.battingHand}-handed
                        </span>
                      </div>

                      {currentPlayer.stats && (
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <div className="text-sm text-slate-400">Matches</div>
                            <div className="text-2xl font-bold text-blue-400">
                              {currentPlayer.stats.matches}
                            </div>
                          </div>
                          <div>
                            <div className="text-sm text-slate-400">Runs</div>
                            <div className="text-2xl font-bold text-green-400">
                              {currentPlayer.stats.runs}
                            </div>
                          </div>
                          <div>
                            <div className="text-sm text-slate-400">Wickets</div>
                            <div className="text-2xl font-bold text-red-400">
                              {currentPlayer.stats.wickets}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Current Bid Display */}
                  <motion.div 
                    className="bg-gradient-to-r from-yellow-600 to-orange-600 rounded-xl p-6 text-center"
                    animate={{ scale: [1, 1.02, 1] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  >
                    <div className="text-sm font-semibold mb-2 opacity-90">
                      CURRENT BID
                    </div>
                    <motion.div 
                      className="text-6xl font-bold mb-2"
                      key={currentBid}
                      initial={{ scale: 1.2 }}
                      animate={{ scale: 1 }}
                    >
                      ₹{(currentBid / 100000).toFixed(2)}L
                    </motion.div>
                    {currentBidTeam && (
                      <div className="text-sm opacity-90">
                        by {currentBidTeam.name}
                      </div>
                    )}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {!currentPlayer && (
              <div className="text-center py-20 text-slate-400">
                <Trophy className="w-20 h-20 mx-auto mb-4 opacity-50" />
                <p className="text-xl">Click &quot;Next Player&quot; to start auction</p>
              </div>
            )}
          </div>

          {/* Live Feed */}
          <aside className="col-span-3">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5" />
              Live Bids
            </h3>

            <div className="space-y-2">
              <AnimatePresence>
                {recentBids?.slice(0, 8).map((bid, idx) => (
                  <motion.div
                    key={bid._id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ delay: idx * 0.05 }}
                    className="bg-slate-800/70 backdrop-blur rounded-lg p-3 border border-slate-700"
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-semibold">
                        {teams?.find(t => t._id === bid.teamId)?.name}
                      </span>
                      <span className="text-xs text-slate-400">
                        {new Date(bid.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-lg font-bold text-yellow-400">
                      ₹{(bid.amount / 100000).toFixed(2)}L
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}