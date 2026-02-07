// app/auction/[roomId]/page.tsx
"use client";

import {use} from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  SkipForward, Trophy, 
  TrendingUp, Users, Gavel , RotateCcw, Play, Pause
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import {useSound} from '@/hooks/useSound';
import { PlayerResultPopup } from '@/components/auction/PlayerResultPopup';
import { AuctionCompleteScreen } from '@/components/auction/AuctionCompleteScreen';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { TeamLogo } from '@/components/ui/team-logo';

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
  const revertBid = useMutation(api.auctions.revertLastBid);
  const startAuction = useMutation(api.auctions.startAuction);
  const pauseAuction = useMutation(api.auctions.pauseAuction);
  const resumeAuction = useMutation(api.auctions.resumeAuction);

  const [timeLeft, setTimeLeft] = useState(30);
  const [bidding, setBidding] = useState<Id<"teams"> | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState<{
    playerName: string;
    playerPhotoUrl?: string;
    teamName: string | null;
    amount: number;
    sold: boolean;
    teamColor?: string;
  } | null>(null);
  const { play } = useSound();

  // Timer management with better precision
  const handleFinalize = useCallback(async () => {
    if (showResult) return; // Prevent multiple auto-finalizes
    
    // Capture current bid state BEFORE calling finalize mutation
    // This is important because the mutation clears the auction room state
    const hadBidder = Boolean(auctionData?.currentBidTeam);
    const bidAmount = auctionData?.auctionRoom?.currentBidAmount ?? 0;
    const bidderTeam = auctionData?.currentBidTeam;
    const playerName = auctionData?.currentPlayer?.name ?? '';
    const playerPhotoUrl = auctionData?.currentPlayer?.photoUrl;
    
    try {
      const res = (await finalizePlayer({ auctionRoomId })) as {
        playerName?: string;
        teamName?: string | null;
        amount?: number;
        sold?: boolean;
        success?: boolean;
      } | null;

      // Use the mutation response, but fall back to captured state if needed
      // The server sets sold=true when currentBidTeamId && currentBidAmount exist
      const isSold = res?.sold ?? hadBidder;
      const finalTeamName = res?.teamName ?? bidderTeam?.name ?? null;
      const finalAmount = res?.amount ?? bidAmount;
      const finalPlayerName = res?.playerName ?? playerName;

      setResult({
        playerName: finalPlayerName,
        playerPhotoUrl,
        teamName: finalTeamName,
        amount: finalAmount,
        sold: isSold,
        teamColor: auctionData?.teams?.find(t => t.name === finalTeamName || t._id === bidderTeam?._id)?.colorPrimary,
      });
      setShowResult(true);

      // Play sound based on actual sold status
      if (isSold) {
        play('sold', 0.7);
      } else {
        play('unsold', 0.5);
      }

    } catch (error) {
      toast.error(error.message || "Failed to finalize");
    }
  }, [showResult, finalizePlayer, auctionRoomId, auctionData, play]);

  // Timer effect - only runs when auction is live and has a timer
  useEffect(() => {
    // Don't run timer when paused or no timer set
    if (auctionData?.auctionRoom?.status !== 'live') {
      return;
    }

    if (!auctionData?.auctionRoom?.bidTimerEndsAt) {
      return;
    }

    const updateTimer = () => {
      // Double-check we're still live before updating
      if (auctionData?.auctionRoom?.status !== 'live') return;

      const remaining = Math.max(
        0, 
        Math.ceil((auctionData.auctionRoom.bidTimerEndsAt! - Date.now()) / 1000)
      );
      
      // Only update state if value changed (prevents unnecessary re-renders)
      setTimeLeft((prev) => (prev !== remaining ? remaining : prev));

      // Auto-finalize when timer reaches 0 AND auction is still live
      if (remaining === 0 && 
          auctionData.auctionRoom.status === 'live' && 
          auctionData.auctionRoom.currentPlayerId &&
          !showResult) {
        handleFinalize();
      }

      // Play timer warning sound at 10 seconds
      if (remaining === 10) {
        play('timer', 0.3);
      }
    };

    // Run immediately then on interval (500ms is smooth enough, reduces CPU)
    updateTimer();
    const interval = setInterval(updateTimer, 500);
    return () => clearInterval(interval);
  }, [auctionData?.auctionRoom?.bidTimerEndsAt, auctionData?.auctionRoom?.currentPlayerId, auctionData?.auctionRoom?.status, handleFinalize, play, showResult]);

  // Show paused time when auction is paused (computed, not in effect)
  const displayTimeLeft = auctionData?.auctionRoom?.status === 'paused' && auctionData?.auctionRoom?.pausedTimeRemaining
    ? auctionData.auctionRoom.pausedTimeRemaining
    : timeLeft;

  const handleBid = useCallback(async (teamId: Id<"teams">, amount: number) => {
    // Use a short debounce instead of blocking - allows rapid clicks but prevents spam
    if (bidding === teamId) return;
    if (auctionData?.auctionRoom?.status !== 'live') return;

    // Play sound immediately for responsiveness
    play('bid', 0.5);
    setBidding(teamId);

    // Clear bidding state after a short delay (allows quick successive bids from different teams)
    setTimeout(() => setBidding(null), 300);

    try {
      const res = await placeBid({ 
        auctionRoomId, 
        teamId, 
        amount 
      });

      if (res && typeof res === 'object' && 'success' in res) {
        if (!res.success) {
          toast.error(res.reason || 'Bid rejected');
        }
      }
    } catch (error) {
      toast.error((error as Error).message || "Failed to place bid");
    }
  }, [bidding, auctionData?.auctionRoom?.status, placeBid, auctionRoomId, play]);


  const handleNextPlayer = useCallback(async () => {
    try {
      const res = await startNext({ auctionRoomId });
      
      if (res.completed) {
        toast.success("Auction completed! All players have been auctioned.");
      } else {
        play('nextPlayer', 0.5);
        toast.success("Next player loaded!");
      }
    } catch (error) {
      toast.error(error.message || "Failed to load next player");
    }
  }, [startNext, auctionRoomId, play]);

  const handleRevertBid = useCallback(async () => {
    if (!confirm("Are you sure you want to revert the last bid?")) return;

    try {
      await revertBid({ auctionRoomId });
      toast.success("Last bid reverted successfully");
    } catch (error) {
      toast.error(error.message || "Failed to revert bid");
    }
  }, [revertBid, auctionRoomId]);
  
  if (!auctionData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  const { auctionRoom, currentPlayer, currentBidTeam, teams, recentBids, soldPlayers } = auctionData;

  // Show auction complete screen when auction is completed
  if (auctionRoom.status === 'completed') {
    return (
      <AuctionCompleteScreen
        tournamentName={auctionData.tournament?.name || 'Tournament'}
        tournamentId={auctionData.tournament?._id || ''}
        soldPlayers={soldPlayers?.map(p => ({
          _id: p._id,
          name: p.name,
          role: p.role,
          soldPrice: p.soldPrice || 0,
          teamId: p.teamId || '',
        })) || []}
        teams={teams?.map(t => ({
          _id: t._id,
          name: t.name,
          colorPrimary: t.colorPrimary,
          logoUrl: t.logoUrl,
          purseSpent: t.purseSpent,
          purseRemaining: t.purseRemaining,
        })) || []}
        stats={{
          total: auctionData.stats?.total || 0,
          sold: auctionData.stats?.sold || 0,
          unsold: auctionData.stats?.unsold || 0,
        }}
      />
    );
  }

  const currentBid = auctionRoom.currentBidAmount || currentPlayer?.basePrice || 0;
  const minNextBid = currentBid + (auctionData.tournament?.settings.minBidIncrement || 25000);

  const isFirstBid = !recentBids || recentBids.length === 0 || 
                     (recentBids.length === 0 && currentBid === currentPlayer?.basePrice);

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
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
              {/* Revert Last Bid */}
              <Button
                onClick={handleRevertBid}
                disabled={!recentBids || recentBids.length === 0}
                variant="outline"
                size="lg"
                title="Revert last bid"
              > 
                <RotateCcw className="w-4 h-4" />
                Revert Last Bid
              </Button>

              {/* Start/Pause/Resume buttons based on status */}
              {auctionRoom.status === 'waiting' && (
                <Button
                    onClick={async () => {
                    try {
                      await startAuction({ auctionRoomId });
                      toast.success('Auction started!');
                    } catch {
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
                    } catch {
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
                    } catch {
                      toast.error('Failed to resume auction');
                    }
                  }}
                  variant="default"
                  size="lg"
                  className="bg-green-600 hover:bg-green-700">
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
          <aside className="col-span-3">
        <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Users className="w-5 h-5" />
          Teams
        </h3>

        <div className="grid grid-cols-2 gap-4">
          {teams?.map((team) => {
            const isCurrentBidder = team._id === currentBidTeam?._id;
            const canBid = team.purseRemaining >= (isFirstBid ? currentPlayer?.basePrice || 0 : minNextBid);
            const bidAmount = isFirstBid ? (currentPlayer?.basePrice || 0) : minNextBid;
            
            return (
          <motion.div
            key={team._id}
            whileHover={{ scale: canBid && currentPlayer ? 1.02 : 1 }}
            className={`
              relative rounded-xl p-4 border-2 transition-all
              ${isCurrentBidder 
            ? 'border-yellow-500 bg-yellow-500/10 shadow-lg shadow-yellow-500/20' 
            : 'border-slate-700 bg-slate-800/50'
              }
              ${canBid && currentPlayer ? 'hover:border-blue-500 cursor-pointer' : 'opacity-50 cursor-not-allowed'}
            `}
            onClick={() => 
              canBid && currentPlayer && 
              handleBid(team._id, bidAmount)
            }
          >
            {bidding === team._id && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl z-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {/* Team Logo */}
                <TeamLogo
                  name={team.name}
                  logoUrl={team.logoUrl}
                  primaryColor={team.colorPrimary}
                  size="sm"
                />

                <span className="font-semibold text-sm truncate">
                  {team.name.substring(0, 10)}
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
              {formatCurrency(team.purseRemaining)}
            </span>
              </div>
              
              <div className="w-full bg-slate-700 rounded-full h-1.5">
            <motion.div
              className="h-1.5 rounded-full transition-all"
              style={{
                width: `${(team.purseRemaining / (team.purseRemaining + team.purseSpent)) * 100}%`,
                backgroundColor: team.colorPrimary
              }}
            />
              </div>

              {currentPlayer && (
            <div className="text-xs text-center mt-2 pt-2 border-t border-slate-700">
              {canBid ? (
                <span className="text-blue-400 font-semibold">
              Bid: {formatCurrency(bidAmount)}
                </span>
              ) : (
                <span className="text-red-400">
              Insufficient purse
                </span>
              )}
            </div>
              )}
            </div>
          </motion.div>
            );
          })}
        </div>
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
                    className={displayTimeLeft <= 10 ? "text-red-500" : "text-blue-500"}
                    strokeDasharray="364"
                    strokeDashoffset={364 - ((displayTimeLeft / (auctionData.tournament?.settings.bidTimerSeconds || 30)) * 364)}
                    transition={{ duration: 0.1, ease: "linear" }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <motion.div 
                      className={`text-5xl font-bold ${
                        displayTimeLeft <= 10 ? 'text-red-500' : 'text-blue-500'
                      }`}
                      animate={{ scale: displayTimeLeft <= 5 && displayTimeLeft > 0 ? [1, 1.1, 1] : 1 }}
                      transition={{ repeat: displayTimeLeft <= 5 && displayTimeLeft > 0 ? Infinity : 0, duration: 1 }}
                    >
                      {displayTimeLeft}
                    </motion.div>
                    <div className="text-xs text-slate-400 mt-1">seconds</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Player Card */}
            <AnimatePresence mode="wait">
              {currentPlayer ? (
                <motion.div
                  key={currentPlayer._id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-linear-to-br from-slate-800 to-slate-900 rounded-2xl p-8 border border-slate-700 shadow-2xl"
                >
                  <div className="flex gap-6 mb-6">
                    <PlayerAvatar 
                      name={currentPlayer.name} 
                      photoUrl={currentPlayer.photoUrl} 
                      size="2xl"
                      className="rounded-2xl"
                    />
                    
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
                          {currentPlayer.battingBowlingHand}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Current Bid Display */}
                  <motion.div 
                    className="bg-linear-to-r from-yellow-600 to-orange-600 rounded-xl p-6 text-center"
                    animate={{ scale: [1, 1.02, 1] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  >
                    <div className="text-sm font-semibold mb-2 opacity-90">
                      {isFirstBid ? "STARTING PRICE" : "CURRENT BID"}
                    </div>
                    <motion.div 
                      className="text-6xl font-bold mb-2"
                      key={currentBid}
                      initial={{ scale: 1.2 }}
                      animate={{ scale: 1 }}
                    >
                      {formatCurrency(currentBid)}
                    </motion.div>
                    {currentBidTeam && !isFirstBid && (
                      <div className="text-sm opacity-90">
                        by {currentBidTeam.name}
                      </div>
                    )}
                  </motion.div>
                </motion.div>
              ) : (
                <div className="text-center py-20 text-slate-400">
                  <Trophy className="w-20 h-20 mx-auto mb-4 opacity-50" />
                  <p className="text-xl mb-4">
                    {auctionRoom.status === 'completed' 
                      ? 'Auction Completed!' 
                      : 'Click "Next Player" to start auction'
                    }
                  </p>
                  {auctionRoom.status === 'completed' && (
                    <p className="text-sm">
                      All {auctionData.total} players have been auctioned
                    </p>
                  )}
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* Live Feed */}
          <aside className="col-span-3">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5" />
              Live Bids
            </h3>

            <div className="space-y-2">
              {(!recentBids || recentBids.length === 0) ? (
                <div className="text-center py-8 text-slate-500">
                  <p className="text-sm">No bids yet</p>
                  <p className="text-xs mt-1">
                    {isFirstBid ? "First bid starts at base price" : "Waiting for bids..."}
                  </p>
                </div>
              ) : (
                <AnimatePresence>
                  {recentBids.slice(0, 5).map((bid, idx) => (
                    <motion.div
                      key={bid._id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ delay: idx * 0.05 }}
                      className="bg-slate-800/70 backdrop-blur rounded-lg p-3 border border-slate-700"
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-semibold truncate">
                          {teams?.find(t => t._id === bid.teamId)?.name}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(bid.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-lg font-bold text-yellow-400">
                        {formatCurrency(bid.amount)}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              
            </div>

            {/* Quick Stats */}
            {currentPlayer && (
              <div className="mt-8 bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                <h4 className="font-semibold mb-3 text-sm">Player Info</h4>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Base Price</span>
                    <span className="font-semibold">
                      {formatCurrency(currentPlayer.basePrice)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Next Bid</span>
                    <span className="font-semibold text-green-400">
                      {formatCurrency(isFirstBid ? currentPlayer.basePrice : minNextBid)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Total Bids</span>
                    <span className="font-semibold">{recentBids?.length || 0}</span>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>

      {/* Result Popup */}
      {showResult && result && (
        <PlayerResultPopup
          show={showResult}
          playerName={result.playerName}
          playerPhotoUrl={result.playerPhotoUrl}
          teamName={result.teamName}
          amount={result.amount}
          sold={result.sold}
          teamColor={result.teamColor}
          onClose={async () => {
            setShowResult(false);
            // Auto-advance if auction is still live and there are more players
            // Wait a tick to let popup close visually
            setTimeout(async () => {
              // Only auto-advance if auction is live and not completed
              if (
                auctionData?.auctionRoom?.status === 'live' &&
                (auctionData?.stats?.pending > 0 || auctionData?.stats?.unsold > 0 || auctionData?.stats?.inAuction > 0)
              ) {
                await handleNextPlayer();
              }
            }, 100);
          }}
        />
      )}
    </div>
  );
}