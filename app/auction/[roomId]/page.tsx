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
  TrendingUp, Users, Gavel , RotateCcw, Play, Pause, RefreshCcw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import {useSound} from '@/hooks/useSound';
import { PlayerResultPopup } from '@/components/auction/PlayerResultPopup';
import { AuctionCompleteScreen } from '@/components/auction/AuctionCompleteScreen';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { TeamLogo } from '@/components/ui/team-logo';
import Image from 'next/image';

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
  const restartAuction = useMutation(api.auctions.restartAuction);

  const [timeLeft, setTimeLeft] = useState(30);
  const [bidding, setBidding] = useState<Id<"teams"> | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState<{
    playerName: string;
    playerPhotoUrl?: string;
    teamName: string | null;
    teamLogoUrl?: string;
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
      const winningTeam = auctionData?.teams?.find(t => t.name === finalTeamName || t._id === bidderTeam?._id);

      setResult({
        playerName: finalPlayerName,
        playerPhotoUrl,
        teamName: finalTeamName,
        teamLogoUrl: winningTeam?.logoUrl,
        amount: finalAmount,
        sold: isSold,
        teamColor: winningTeam?.colorPrimary,
      });
      setShowResult(true);

      // Play sound based on actual sold status
      if (isSold) {
        play('sold', 0.7);
      } else {
        play('unsold', 0.5);
      }

    } catch (error) {
      toast.error((error as Error)?.message || "Failed to finalize");
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
      toast.error((error as Error).message || "Failed to load next player");
    }
  }, [startNext, auctionRoomId, play]);

  const handleRevertBid = useCallback(async () => {
    if (!confirm("Are you sure you want to revert the last bid?")) return;

    try {
      await revertBid({ auctionRoomId });
      toast.success("Last bid reverted successfully");
    } catch (error) {
      toast.error((error as Error).message || "Failed to revert bid");
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
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50 safe-top">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              {/* Tournament Logo */}
              {auctionData.tournament?.logoUrl ? (
                <div className="relative">
                  <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl overflow-hidden border-2 border-yellow-500/50 shadow-lg shadow-yellow-500/20">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img 
                      src={auctionData.tournament.logoUrl} 
                      alt={auctionData.tournament.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 bg-green-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-white rounded-full animate-pulse" />
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl bg-linear-to-br from-yellow-500 to-orange-600 flex items-center justify-center border-2 border-yellow-500/50 shadow-lg shadow-yellow-500/20">
                    <Trophy className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 bg-green-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-white rounded-full animate-pulse" />
                  </div>
                </div>
              )}
              <div className="hidden sm:block">
                <h1 className="text-lg sm:text-xl lg:text-2xl font-bold truncate max-w-50 lg:max-w-none">
                  {auctionData.tournament?.name}
                </h1>
                <p className="text-xs sm:text-sm text-slate-400">
                  {auctionRoom.status === 'waiting' && 'Waiting to start'}
                  {auctionRoom.status === 'live' && 'Live Auction'}
                  {auctionRoom.status === 'paused' && 'Auction Paused'}
                </p>
              </div>
            </div>

             <div className="flex flex-wrap justify-end gap-1.5 sm:gap-2">
              {/* Revert Last Bid */}
              <Button
                onClick={handleRevertBid}
                disabled={!recentBids || recentBids.length === 0}
                variant="outline"
                size="lg"
                title="Revert last bid"
                className="h-10 sm:h-11 px-2.5 sm:px-4 text-sm touch-target"
              > 
                <RotateCcw className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Revert</span>
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
                  className="bg-green-600 hover:bg-green-700 h-10 sm:h-11 px-3 sm:px-4 text-sm touch-target"
                >
                  <Play className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2" />
                  <span className="hidden sm:inline">Start</span>
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
                  className="h-10 sm:h-11 px-3 sm:px-4 text-sm touch-target"
                >
                  <Pause className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2" />
                  <span className="hidden sm:inline">Pause</span>
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
                  className="bg-green-600 hover:bg-green-700 h-10 sm:h-11 px-3 sm:px-4 text-sm touch-target">
                  <Play className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2" />
                  <span className="hidden sm:inline">Resume</span>
                </Button>
              )}

              {/* Restart Auction Button */}
              <Button
                onClick={async () => {
                  if (!confirm("Are you sure you want to restart the auction? This will reset ALL players, teams purses, and bid history. This action cannot be undone.")) return;
                  try {
                    await restartAuction({ auctionRoomId });
                    toast.success('Auction has been reset!');
                  } catch (error) {
                    toast.error((error as Error).message || 'Failed to restart auction');
                  }
                }}
                variant="outline"
                size="lg"
                className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300 h-10 sm:h-11 px-2.5 sm:px-4 text-sm touch-target"
                title="Restart auction from the beginning"
              >
                <RefreshCcw className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2" />
                <span className="hidden sm:inline">Restart</span>
              </Button>


              <Button
                onClick={handleFinalize}
                disabled={!currentPlayer || auctionRoom.status !== 'live'}
                variant="outline"
                size="lg"
                className="h-10 sm:h-11 px-2.5 sm:px-4 text-sm touch-target"
              >
                <Gavel className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2" />
                <span className="hidden sm:inline">Finalize</span>
              </Button>
              <Button
                onClick={handleNextPlayer}
                disabled={auctionRoom.currentPlayerId !== undefined || auctionRoom.status !== 'live'}
                size="lg"
                className="h-10 sm:h-11 px-3 sm:px-4 text-sm touch-target"
              >
                <SkipForward className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2" />
                <span className="hidden sm:inline">Next</span>
              </Button>
            </div>
          </div>
        </div>
      </header>
                
      <main className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8 pb-20 safe-bottom">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 lg:gap-6">
          {/* Teams Panel - Full width on mobile/tablet, side panel on desktop */}
          <aside className="lg:col-span-3 order-2 lg:order-1">
        <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2 mb-3 sm:mb-4">
          <Users className="w-4 h-4 sm:w-5 sm:h-5" />
          Teams
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
          {teams?.map((team) => {
            const isCurrentBidder = team._id === currentBidTeam?._id;
            const teamPlayerCount = soldPlayers?.filter(p => p.teamId === team._id).length || 0;
            const maxPlayersPerTeam = auctionData.tournament?.settings.maxPlayersPerTeam || 15;
            const hasReachedMaxPlayers = teamPlayerCount >= maxPlayersPerTeam;
            const hasSufficientPurse = team.purseRemaining >= (isFirstBid ? currentPlayer?.basePrice || 0 : minNextBid);
            const canBid = hasSufficientPurse && !hasReachedMaxPlayers;
            const bidAmount = isFirstBid ? (currentPlayer?.basePrice || 0) : minNextBid;
            
            return (
          <motion.div
            key={team._id}
            whileHover={{ scale: canBid && currentPlayer ? 1.03 : 1 }}
            whileTap={{ scale: canBid && currentPlayer ? 0.97 : 1 }}
            className={`
              relative rounded-xl p-2.5 sm:p-3 border-2 transition-all cursor-pointer touch-target
              ${isCurrentBidder 
            ? 'border-yellow-500 bg-yellow-500/10 shadow-lg shadow-yellow-500/20' 
            : 'border-slate-700 bg-slate-800/50'
              }
              ${canBid && currentPlayer ? 'hover:border-blue-500 active:bg-blue-500/10' : 'opacity-50 cursor-not-allowed'}
            `}
            onClick={() => 
              canBid && currentPlayer && 
              handleBid(team._id, bidAmount)
            }
          >
            {bidding === team._id && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl z-10">
            <div className="animate-spin rounded-full h-5 w-5 sm:h-6 sm:w-6 border-b-2 border-white" />
              </div>
            )}

            <div className="flex items-center gap-2">
              {/* Team Logo */}
              <TeamLogo
                name={team.name}
                logoUrl={team.logoUrl}
                primaryColor={team.colorPrimary}
                size="sm"
              />

              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs sm:text-sm truncate block">
                  {team.name}
                </span>
                {currentPlayer && (
                  <span className={`text-xs ${
                    hasReachedMaxPlayers ? 'text-red-400' : 
                    !hasSufficientPurse ? 'text-red-400' : 
                    'text-blue-400'
                  }`}>
                    {hasReachedMaxPlayers ? 'Full' : 
                     !hasSufficientPurse ? 'Low purse' : 
                     formatCurrency(bidAmount)}
                  </span>
                )}
              </div>

              {isCurrentBidder && (
                <Gavel className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-yellow-500 animate-pulse shrink-0" />
              )}
            </div>
          </motion.div>
            );
          })}
        </div>
          </aside>

          {/* Center Stage */}
          <div className="lg:col-span-6 order-1 lg:order-2">
            {/* Timer */}
            <div className="flex justify-center mb-4 sm:mb-6 lg:mb-8">
              <div className="relative">
                <svg className="w-24 h-24 sm:w-28 sm:h-28 lg:w-32 lg:h-32 transform -rotate-90">
                  <circle
                    cx="50%"
                    cy="50%"
                    r="45%"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    className="text-slate-800"
                  />
                  <motion.circle
                    cx="50%"
                    cy="50%"
                    r="45%"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    className={displayTimeLeft <= 10 ? "text-red-500" : "text-blue-500"}
                    strokeDasharray="283"
                    strokeDashoffset={283 - ((displayTimeLeft / (auctionData.tournament?.settings.bidTimerSeconds || 30)) * 283)}
                    transition={{ duration: 0.1, ease: "linear" }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <motion.div 
                      className={`text-3xl sm:text-4xl lg:text-5xl font-bold ${
                        displayTimeLeft <= 10 ? 'text-red-500' : 'text-blue-500'
                      }`}
                      animate={{ scale: displayTimeLeft <= 5 && displayTimeLeft > 0 ? [1, 1.1, 1] : 1 }}
                      transition={{ repeat: displayTimeLeft <= 5 && displayTimeLeft > 0 ? Infinity : 0, duration: 1 }}
                    >
                      {displayTimeLeft}
                    </motion.div>
                    <div className="text-xs text-slate-400 mt-0.5 sm:mt-1">seconds</div>
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
                  className="bg-linear-to-br from-slate-800 to-slate-900 rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-8 border border-slate-700 shadow-2xl"
                >
                  <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 mb-4 sm:mb-6">
                    <PlayerAvatar 
                      name={currentPlayer.name} 
                      photoUrl={currentPlayer.photoUrl} 
                      size="2xl"
                      className="rounded-xl sm:rounded-2xl mx-auto sm:mx-0"
                    />
                    
                    <div className="flex-1 text-center sm:text-left">
                      <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2 sm:mb-3">
                        {currentPlayer.name}
                      </h2>
                      
                      <div className="flex flex-wrap justify-center sm:justify-start gap-2 mb-3 sm:mb-4">
                        <span className="px-3 sm:px-4 py-1.5 sm:py-2 bg-purple-600 rounded-full text-xs sm:text-sm font-semibold">
                          {currentPlayer.role}
                        </span>
                        <span className="px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-700 rounded-full text-xs sm:text-sm">
                          {currentPlayer.age} years
                        </span>
                        <span className="px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-700 rounded-full text-xs sm:text-sm">
                          {currentPlayer.battingBowlingHand}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Current Bid Display */}
                  <motion.div 
                    className="bg-linear-to-r from-yellow-600 to-orange-600 rounded-xl p-4 sm:p-5 lg:p-6 text-center"
                    animate={{ scale: [1, 1.02, 1] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  >
                    <div className="text-xs sm:text-sm font-semibold mb-1 sm:mb-2 opacity-90">
                      {isFirstBid ? "STARTING PRICE" : "CURRENT BID"}
                    </div>
                    <motion.div 
                      className="text-3xl sm:text-4xl lg:text-6xl font-bold mb-1 sm:mb-2"
                      key={currentBid}
                      initial={{ scale: 1.2 }}
                      animate={{ scale: 1 }}
                    >
                      {formatCurrency(currentBid)}
                    </motion.div>
                    {currentBidTeam && !isFirstBid && (
                      <div className="text-xs sm:text-sm opacity-90">
                        by {currentBidTeam.name}
                      </div>
                    )}
                  </motion.div>
                </motion.div>
              ) : (
                <div className="text-center py-12 sm:py-16 lg:py-20 text-slate-400">
                  <Trophy className="w-14 h-14 sm:w-16 sm:h-16 lg:w-20 lg:h-20 mx-auto mb-3 sm:mb-4 opacity-50" />
                  <p className="text-base sm:text-lg lg:text-xl mb-4">
                    Click &quot;Next Player&quot; to start auction
                  </p>
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* Live Feed */}
          <aside className="lg:col-span-3 order-3">
            <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2 mb-3 sm:mb-4">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" />
              Live Bids
            </h3>

            <div className="space-y-2">
              {(!recentBids || recentBids.length === 0) ? (
                <div className="text-center py-6 sm:py-8 text-slate-500">
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
                      className="bg-slate-800/70 backdrop-blur rounded-lg p-2.5 sm:p-3 border border-slate-700"
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs sm:text-sm font-semibold truncate">
                          {teams?.find(t => t._id === bid.teamId)?.name}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(bid.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-base sm:text-lg font-bold text-yellow-400">
                        {formatCurrency(bid.amount)}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              
            </div>

            {/* Quick Stats */}
            {currentPlayer && (
              <div className="mt-6 sm:mt-8 bg-slate-800/50 rounded-lg p-3 sm:p-4 border border-slate-700">
                <h4 className="font-semibold mb-2 sm:mb-3 text-sm">Player Info</h4>
                <div className="space-y-2 sm:space-y-3">
                  <div className="flex justify-between text-xs sm:text-sm">
                    <span className="text-slate-400">Base Price</span>
                    <span className="font-semibold">
                      {formatCurrency(currentPlayer.basePrice)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs sm:text-sm">
                    <span className="text-slate-400">Next Bid</span>
                    <span className="font-semibold text-green-400">
                      {formatCurrency(isFirstBid ? currentPlayer.basePrice : minNextBid)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs sm:text-sm">
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
          teamLogoUrl={result.teamLogoUrl}
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

      {/* Live Stats Crawler/Ticker */}
      <div className="fixed bottom-0 left-0 right-0 bg-linear-to-r from-slate-900 via-slate-800 to-slate-900 border-t border-slate-700 py-2 z-40 overflow-hidden">
        <div className="relative flex items-center">
          <div className="absolute left-0 w-16 h-full bg-linear-to-r from-slate-900 to-transparent z-10" />
          <div className="absolute right-0 w-16 h-full bg-linear-to-l from-slate-900 to-transparent z-10" />
          <motion.div
            className="flex gap-8 px-8 whitespace-nowrap"
            animate={{ x: ["0%", "-50%"] }}
            transition={{
              x: {
                repeat: Infinity,
                repeatType: "loop",
                duration: 20,
                ease: "linear",
              },
            }}
          >
            {/* Duplicate content for seamless loop */}
            {[...Array(2)].map((_, loopIndex) => (
              <div key={loopIndex} className="flex gap-8">
                {auctionData?.teams?.map((team) => {
                  const teamPlayers = soldPlayers?.filter(p => p.teamId === team._id) || [];
                  return (
                    <div 
                      key={`${loopIndex}-${team._id}`}
                      className="flex items-center gap-2 bg-slate-800/50 rounded-full px-4 py-1.5 border border-slate-700 shrink-0"
                    >
                      {team.logoUrl ? (
                        <Image 
                          src={team.logoUrl} 
                          alt={team.name} 
                          width={24}
                          height={24}
                          className="w-6 h-6 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div 
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                          style={{ backgroundColor: team.colorPrimary || '#6366f1' }}
                        >
                          {team.name.charAt(0)}
                        </div>
                      )}
                      <span className="font-medium text-white text-sm">{team.name}</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-emerald-400 font-semibold text-sm">
                        {formatCurrency(team.purseRemaining || 0)}
                      </span>
                      <span className="text-slate-500">•</span>
                      <span className={`text-sm font-medium ${teamPlayers.length >= (auctionData.tournament?.settings.maxPlayersPerTeam || 15) ? 'text-red-400' : 'text-sky-400'}`}>
                        {teamPlayers.length}/{auctionData.tournament?.settings.maxPlayersPerTeam || 15}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  );
}