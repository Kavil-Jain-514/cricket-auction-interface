// app/auction/[roomId]/page.tsx
"use client";

import React, { use, useRef, useMemo } from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { motion, AnimatePresence } from 'framer-motion';
import {
  SkipForward, Trophy,
  Users, Gavel, RotateCcw, RotateCw, Play, Pause, RefreshCcw,
  Eye, Settings2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { formatCurrency, getErrorMessage, getRoleDisplay } from '@/lib/utils';
import { useSound } from '@/hooks/useSound';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { useUserRole } from '@/hooks/useUserRole';
import dynamic from 'next/dynamic';
import { PlayerIntroFlash } from '@/components/auction/PlayerIntroFlash';
import { ViewerTeamsPanel } from '@/components/auction/ViewerTeamsPanel';
import { AuctionLiveBids } from '@/components/auction/AuctionLiveBids';
import { AdminTeamsPanel } from '@/components/auction/AdminTeamsPanel';

// Lazy-load heavy components that are only used conditionally
const PlayerResultPopup = dynamic(() => import('@/components/auction/PlayerResultPopup').then(m => ({ default: m.PlayerResultPopup })), { ssr: false });
const AuctionCompleteScreen = dynamic(() => import('@/components/auction/AuctionCompleteScreen').then(m => ({ default: m.AuctionCompleteScreen })), { ssr: false });
const AdminPlayerManager = dynamic(() => import('@/components/auction/AdminPlayerManager').then(m => ({ default: m.AdminPlayerManager })), { ssr: false });

interface AuctionPageProps {
  params: Promise<{ roomId: string }>;
}

export default function AuctionPage({ params }: AuctionPageProps) {
  const { roomId } = use(params);
  const auctionRoomId = roomId as Id<"auctionRooms">;

  // RBAC - Role Based Access Control
  const { isAdmin } = useUserRole();

  // Convex queries and mutations
  const auctionData = useQuery(api.auctions.getLiveAuction, {
    auctionRoomId
  });
  const placeBid = useMutation(api.auctions.placeBid);
  const finalizePlayer = useMutation(api.auctions.finalizePlayerSale);
  const startNext = useMutation(api.auctions.startNextPlayer);
  const revertBid = useMutation(api.auctions.revertLastBid);
  const restartCurrentPlayer = useMutation(api.auctions.restartCurrentPlayer);
  const startAuction = useMutation(api.auctions.startAuction);
  const pauseAuction = useMutation(api.auctions.pauseAuction);
  const resumeAuction = useMutation(api.auctions.resumeAuction);
  const restartAuction = useMutation(api.auctions.restartAuction);

  const [timeLeft, setTimeLeft] = useState(30);
  const [bidding, setBidding] = useState<Id<"teams"> | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [customBidAmounts, setCustomBidAmounts] = useState<Record<string, number>>({});
  const [showPlayerIntro, setShowPlayerIntro] = useState(false);
  const [showPlayerManager, setShowPlayerManager] = useState(false);
  const lastPlayerIdRef = useRef<string | null>(null);
  const introTimerRef = useRef<NodeJS.Timeout | null>(null);
  const finalizingRef = useRef(false);

  // Viewer mode status flash notifications
  const [statusFlash, setStatusFlash] = useState<{
    type: 'paused' | 'resumed' | 'reverted' | 'rebid' | 'sold' | 'unsold' | 'new_bid' | null;
    message: string;
    teamName?: string;
    teamColor?: string;
    amount?: number;
    playerName?: string;
  } | null>(null);
  const prevAuctionStatusRef = useRef<string | null>(null);
  const prevBidCountRef = useRef<number>(0);
  const prevCurrentPlayerIdRef = useRef<string | null>(null);
  // Track player info for sold/unsold flash
  const prevPlayerInfoRef = useRef<{
    name: string;
    photoUrl?: string;
    teamName?: string;
    teamColor?: string;
    teamLogoUrl?: string;
    amount?: number;
    basePrice?: number;
  } | null>(null);

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
    if (!isAdmin) return; // Only admins can finalize
    if (showResult) return; // Prevent multiple auto-finalizes
    // Capture current bid state BEFORE calling finalize mutation
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
        reason?: string;
      } | null;

      // Another admin tab already finalized this player — silently ignore.
      if (res && !res.success && res.reason === "No player in auction") return;

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
      if (isSold) {
        play('sold', 0.7);
      } else {
        play('unsold', 0.5);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to finalize"));
    }
  }, [isAdmin, showResult, finalizePlayer, auctionRoomId, auctionData, play]);

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
      // Guard with finalizingRef to prevent double-finalize from rapid re-renders
      if (remaining === 0 &&
        auctionData.auctionRoom.status === 'live' &&
        auctionData.auctionRoom.currentPlayerId &&
        !showResult &&
        !finalizingRef.current) {
        finalizingRef.current = true;
        handleFinalize().finally(() => { finalizingRef.current = false; });
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

  // Player intro flash effect - shows when a new player comes up
  useEffect(() => {
    const newPlayerId = auctionData?.auctionRoom?.currentPlayerId;
    const player = auctionData?.currentPlayer;

    // Check if this is a new player (different from last one we showed intro for)
    let rafClearBids = 0;
    let rafIntro = 0;

    if (newPlayerId && player && newPlayerId !== lastPlayerIdRef.current) {
      lastPlayerIdRef.current = newPlayerId;

      // Reset custom bid amounts so the accumulated map doesn't grow unboundedly.
      // Also auto-close the result popup for viewers when admin loads the next player.
      rafClearBids = requestAnimationFrame(() => {
        setCustomBidAmounts({});
        setShowResult(false);
      });

      // Clear any existing timer
      if (introTimerRef.current) {
        clearTimeout(introTimerRef.current);
      }

      // Defer state update to next frame.
      rafIntro = requestAnimationFrame(() => {
        setShowPlayerIntro(true);

        // Auto-hide after 2 seconds
        introTimerRef.current = setTimeout(() => {
          setShowPlayerIntro(false);
        }, 2000);
      });
    }

    return () => {
      if (rafClearBids) cancelAnimationFrame(rafClearBids);
      if (rafIntro) cancelAnimationFrame(rafIntro);
      if (introTimerRef.current) {
        clearTimeout(introTimerRef.current);
      }
    };
  }, [auctionData?.auctionRoom?.currentPlayerId, auctionData?.currentPlayer]);

  // Viewer mode: Track status changes and show flash notifications
  const showStatusFlash = useCallback((flash: typeof statusFlash) => {
    setStatusFlash(flash);
  }, []);

  useEffect(() => {
    if (isAdmin) return; // Only for viewers

    const currentStatus = auctionData?.auctionRoom?.status;
    const currentBidCount = auctionData?.recentBids?.length ?? 0;
    const currentPlayerIdNow = auctionData?.auctionRoom?.currentPlayerId;
    const currentPlayer = auctionData?.currentPlayer;
    const currentBidTeam = auctionData?.currentBidTeam;
    const currentBidAmountNow = auctionData?.auctionRoom?.currentBidAmount;

    let flashToShow: typeof statusFlash = null;
    let soldUnsoldResult: typeof result = null;

    // Check for player sold/unsold (player was being auctioned and now no player is selected)
    if (!soldUnsoldResult && !flashToShow && prevCurrentPlayerIdRef.current && !currentPlayerIdNow && prevPlayerInfoRef.current) {
      if (prevPlayerInfoRef.current.teamName && prevPlayerInfoRef.current.amount) {
        // Player was sold — capture for full result popup (same as admin)
        soldUnsoldResult = {
          playerName: prevPlayerInfoRef.current.name,
          playerPhotoUrl: prevPlayerInfoRef.current.photoUrl,
          teamName: prevPlayerInfoRef.current.teamName,
          teamLogoUrl: prevPlayerInfoRef.current.teamLogoUrl,
          amount: prevPlayerInfoRef.current.amount,
          sold: true,
          teamColor: prevPlayerInfoRef.current.teamColor,
        };
      } else {
        // Player went unsold — capture for full result popup
        soldUnsoldResult = {
          playerName: prevPlayerInfoRef.current.name,
          playerPhotoUrl: prevPlayerInfoRef.current.photoUrl,
          teamName: null,
          amount: prevPlayerInfoRef.current.basePrice ?? 0,
          sold: false,
        };
      }
    }

    // Check for auction paused/resumed
    if (!flashToShow && prevAuctionStatusRef.current && currentStatus !== prevAuctionStatusRef.current) {
      if (currentStatus === 'paused') {
        flashToShow = {
          type: 'paused',
          message: 'Auction Paused',
        };
      } else if (currentStatus === 'live' && prevAuctionStatusRef.current === 'paused') {
        flashToShow = {
          type: 'resumed',
          message: 'Auction Resumed',
        };
      }
    }

    // Check for bid reverted (bid count decreased)
    if (!flashToShow && prevBidCountRef.current > 0 && currentBidCount < prevBidCountRef.current) {
      flashToShow = {
        type: 'reverted',
        message: 'Last Bid Reverted',
      };
    }

    // Check for new bid (bid count increased)
    if (!flashToShow && currentBidCount > prevBidCountRef.current && prevBidCountRef.current > 0) {
      const latestBid = auctionData?.recentBids?.[0];
      const biddingTeam = auctionData?.teams?.find(t => t._id === latestBid?.teamId);
      if (latestBid && biddingTeam) {
        flashToShow = {
          type: 'new_bid',
          message: 'New Bid!',
          teamName: biddingTeam.name,
          teamColor: biddingTeam.colorPrimary,
          amount: latestBid.amount,
        };
      }
    }

    // Check for player reset/rebid (same player but bids cleared)
    if (!flashToShow && currentPlayerIdNow &&
      currentPlayerIdNow === prevCurrentPlayerIdRef.current &&
      prevBidCountRef.current > 0 &&
      currentBidCount === 0) {
      flashToShow = {
        type: 'rebid',
        message: 'Bidding Restarted',
      };
    }

    // Update player info ref BEFORE updating player ID ref (to capture last state)
    if (currentPlayerIdNow && currentPlayer) {
      prevPlayerInfoRef.current = {
        name: currentPlayer.name,
        photoUrl: currentPlayer.photoUrl,
        teamName: currentBidTeam?.name,
        teamColor: currentBidTeam?.colorPrimary,
        teamLogoUrl: currentBidTeam?.logoUrl,
        amount: currentBidAmountNow,
        basePrice: currentPlayer.basePrice,
      };
    }

    // Update refs
    prevAuctionStatusRef.current = currentStatus ?? null;
    prevBidCountRef.current = currentBidCount;
    prevCurrentPlayerIdRef.current = currentPlayerIdNow ?? null;

    // Show sold/unsold as full result popup (same experience as admin)
    let rafFlash = 0;
    if (soldUnsoldResult) {
      rafFlash = requestAnimationFrame(() => {
        setResult(soldUnsoldResult);
        setShowResult(true);
        if (soldUnsoldResult!.sold) {
          play('sold', 0.7);
        } else {
          play('unsold', 0.5);
        }
      });
    } else if (flashToShow) {
      // Other flashes (paused, resumed, reverted, rebid, new_bid) stay as banners
      rafFlash = requestAnimationFrame(() => {
        showStatusFlash(flashToShow);
      });
    }

    return () => {
      if (rafFlash) cancelAnimationFrame(rafFlash);
    };
  }, [isAdmin, auctionData?.auctionRoom?.status, auctionData?.recentBids, auctionData?.auctionRoom?.currentPlayerId, auctionData?.teams, auctionData?.currentPlayer, auctionData?.currentBidTeam, auctionData?.auctionRoom?.currentBidAmount, showStatusFlash, play]);

  // Auto-hide status flash after 3 seconds
  useEffect(() => {
    if (statusFlash) {
      const timer = setTimeout(() => {
        setStatusFlash(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [statusFlash]);

  // Track the current player ID and bid amount 
  const currentPlayerId = auctionData?.auctionRoom?.currentPlayerId;
  const currentBidAmount = auctionData?.auctionRoom?.currentBidAmount;

  // Create a unique key that changes when player or bid changes
  // This will be used to namespace our custom bid amounts
  const bidContextKey = `${currentPlayerId || 'none'}-${currentBidAmount || 0}`;

  // Get custom amount for a team, or return the minimum bid as default
  const getCustomBidAmount = useCallback((teamId: string, minBid: number): number => {
    const key = `${bidContextKey}-${teamId}`;
    return customBidAmounts[key] ?? minBid;
  }, [bidContextKey, customBidAmounts]);

  // Set custom amount for a team with the context key
  const setCustomBidAmount = useCallback((teamId: string, amount: number) => {
    const key = `${bidContextKey}-${teamId}`;
    setCustomBidAmounts(prev => ({ ...prev, [key]: amount }));
  }, [bidContextKey]);

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
      toast.error(getErrorMessage(error, "Failed to place bid"));
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
      toast.error(getErrorMessage(error, "Failed to load next player"));
    }
  }, [startNext, auctionRoomId, play]);

  const handleRevertBid = useCallback(async () => {
    if (!confirm("Are you sure you want to revert the last bid?")) return;

    try {
      await revertBid({ auctionRoomId });
      toast.success("Last bid reverted successfully");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to revert bid"));
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
        tournamentLogoUrl={auctionData.tournament?.logoUrl}
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
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white relative overflow-hidden">
      {/* Cricket Stadium Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        {/* Cricket field green gradient at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-linear-to-t from-green-900/15 to-transparent" />

        {/* Stadium floodlight effects */}
        <div className="absolute top-0 left-[15%] w-80 h-80 bg-yellow-500/5 rounded-full blur-3xl" />
        <div className="absolute top-0 right-[15%] w-80 h-80 bg-yellow-500/5 rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-0 w-60 h-60 bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-0 w-60 h-60 bg-blue-500/5 rounded-full blur-3xl" />

        {/* Cricket pitch markings - subtle center line */}
        <div className="absolute left-1/2 bottom-0 w-px h-32 bg-linear-to-t from-green-700/20 to-transparent transform -translate-x-1/2" />

        {/* Floating cricket ball decorations */}
        <svg className="absolute top-20 left-8 w-8 h-8 opacity-10 animate-bounce" style={{ animationDuration: '4s' }} viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="#DC2626" />
          <path d="M20 50 Q35 30, 50 50 Q65 70, 80 50" fill="none" stroke="white" strokeWidth="4" />
          <path d="M20 50 Q35 70, 50 50 Q65 30, 80 50" fill="none" stroke="white" strokeWidth="4" />
        </svg>
        <svg className="absolute bottom-32 right-12 w-6 h-6 opacity-10 animate-bounce" style={{ animationDuration: '3.5s', animationDelay: '1s' }} viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="#DC2626" />
          <path d="M20 50 Q35 30, 50 50 Q65 70, 80 50" fill="none" stroke="white" strokeWidth="4" />
          <path d="M20 50 Q35 70, 50 50 Q65 30, 80 50" fill="none" stroke="white" strokeWidth="4" />
        </svg>

        {/* Cricket stumps decoration */}
        <svg className="absolute bottom-8 left-10 w-8 h-16 opacity-10" viewBox="0 0 60 100">
          <rect x="8" y="10" width="6" height="80" fill="#D4A574" rx="1" />
          <rect x="27" y="10" width="6" height="80" fill="#D4A574" rx="1" />
          <rect x="46" y="10" width="6" height="80" fill="#D4A574" rx="1" />
          <rect x="5" y="8" width="20" height="4" fill="#8B4513" rx="1" />
          <rect x="35" y="8" width="20" height="4" fill="#8B4513" rx="1" />
        </svg>
      </div>

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

            {/* Admin Controls - Only visible to admins */}
            {isAdmin ? (
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

                {/* Restart Current Player */}
                <Button
                  onClick={async () => {
                    if (!confirm("Restart bidding for this player? All bids will be cleared and timer will reset.")) return;
                    try {
                      await restartCurrentPlayer({ auctionRoomId });
                      toast.success('Player bidding restarted!');
                    } catch (error) {
                      toast.error(getErrorMessage(error, 'Failed to restart player'));
                    }
                  }}
                  disabled={!currentPlayer || auctionRoom.status !== 'live'}
                  variant="outline"
                  size="lg"
                  title="Restart bidding for current player"
                  className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300 h-10 sm:h-11 px-2.5 sm:px-4 text-sm touch-target"
                >
                  <RotateCw className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Re-bid</span>
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
                      toast.error(getErrorMessage(error, 'Failed to restart auction'));
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

                {/* Manage Players Button */}
                <Button
                  onClick={() => setShowPlayerManager(true)}
                  variant="outline"
                  size="lg"
                  className="border-purple-500/50 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300 h-10 sm:h-11 px-2.5 sm:px-4 text-sm touch-target"
                  title="Manage sold/unsold players"
                >
                  <Settings2 className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2" />
                  <span className="hidden sm:inline">Players</span>
                </Button>


                {isAdmin && (
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
                )}
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
            ) : (
              /* Viewer Mode: Compact Timer + Bid11Pro Branding */
              <div className="flex items-center gap-3 sm:gap-5">
                {/* Compact countdown timer */}
                <div className="relative w-11 h-11 sm:w-14 sm:h-14 shrink-0">
                  <div className={`absolute inset-0 rounded-full blur-md transition-colors ${displayTimeLeft <= 10 ? 'bg-red-500/40' : 'bg-orange-500/20'}`} />
                  <svg className="w-full h-full transform -rotate-90 relative z-10" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" stroke="currentColor" strokeWidth="12" fill="none" className="text-slate-700" />
                    <motion.circle
                      cx="50" cy="50" r="42"
                      stroke="currentColor" strokeWidth="12" fill="none"
                      className={displayTimeLeft <= 10 ? "text-red-500" : "text-orange-500"}
                      strokeDasharray={2 * Math.PI * 42}
                      strokeDashoffset={2 * Math.PI * 42 * (1 - displayTimeLeft / (auctionData.tournament?.settings.bidTimerSeconds || 30))}
                      strokeLinecap="round"
                      transition={{ duration: 0.1, ease: "linear" }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center z-20">
                    <motion.span
                      className={`text-sm sm:text-base font-extrabold ${displayTimeLeft <= 10 ? 'text-red-400' : 'text-orange-300'}`}
                      animate={{ scale: displayTimeLeft <= 5 && displayTimeLeft > 0 ? [1, 1.15, 1] : 1 }}
                      transition={{ repeat: displayTimeLeft <= 5 && displayTimeLeft > 0 ? Infinity : 0, duration: 0.8 }}
                    >
                      {displayTimeLeft}
                    </motion.span>
                  </div>
                </div>

                {/* Divider */}
                <div className="hidden sm:block h-9 w-px bg-slate-700" />

                {/* Bid11Pro Branding */}
                <div className="hidden sm:flex flex-col">
                  <span className="text-lg sm:text-xl font-extrabold tracking-tight bg-linear-to-r from-yellow-400 via-orange-400 to-orange-500 bg-clip-text text-transparent leading-tight">
                    Bid11Pro
                  </span>
                  <span className="text-[10px] sm:text-[11px] text-slate-400 leading-tight">
                    Developed by Kavil Dani · +91-7406486484
                  </span>
                </div>

                {/* Viewer badge */}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-500/10 rounded-lg border border-blue-500/30">
                  <Eye className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-medium text-blue-300">Viewer</span>
                </div>
              </div>
            )}

            {/* View Teams Button - Available for both Admin and Viewer */}
            <Button
              onClick={() => window.open(`/tournament/${auctionData.tournament?._id}/teams`, '_blank')}
              variant="outline"
              size="lg"
              className="h-10 sm:h-11 px-2.5 sm:px-4 text-sm touch-target border-slate-600 hover:bg-slate-800"
              title="View all teams in new tab"
            >
              <Users className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2" />
              <span className="hidden sm:inline">View Teams</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Viewer Status Flash Notification */}
      <AnimatePresence>
        {!isAdmin && statusFlash && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50"
          >
            <div className={`
              px-6 py-4 rounded-xl shadow-2xl border-2 backdrop-blur-lg
              ${statusFlash.type === 'paused' ? 'bg-yellow-500/90 border-yellow-400 text-yellow-950' : ''}
              ${statusFlash.type === 'resumed' ? 'bg-green-500/90 border-green-400 text-green-950' : ''}
              ${statusFlash.type === 'reverted' ? 'bg-orange-500/90 border-orange-400 text-orange-950' : ''}
              ${statusFlash.type === 'rebid' ? 'bg-blue-500/90 border-blue-400 text-blue-950' : ''}
              ${statusFlash.type === 'new_bid' ? 'bg-purple-500/90 border-purple-400 text-purple-950' : ''}
              ${statusFlash.type === 'sold' ? 'bg-green-600/90 border-green-500 text-white' : ''}
              ${statusFlash.type === 'unsold' ? 'bg-red-500/90 border-red-400 text-white' : ''}
            `}>
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center gap-1"
              >
                {/* Icon based on type */}
                {statusFlash.type === 'paused' && <Pause className="w-6 h-6 mb-1" />}
                {statusFlash.type === 'resumed' && <Play className="w-6 h-6 mb-1" />}
                {statusFlash.type === 'reverted' && <RotateCcw className="w-6 h-6 mb-1" />}
                {statusFlash.type === 'rebid' && <RotateCw className="w-6 h-6 mb-1" />}
                {statusFlash.type === 'new_bid' && <Gavel className="w-6 h-6 mb-1" />}
                {statusFlash.type === 'sold' && <Trophy className="w-6 h-6 mb-1" />}
                {statusFlash.type === 'unsold' && <Users className="w-6 h-6 mb-1" />}

                <span className="font-bold text-lg">{statusFlash.message}</span>

                {/* Show player name for sold/unsold */}
                {(statusFlash.type === 'sold' || statusFlash.type === 'unsold') && statusFlash.playerName && (
                  <div className="text-sm font-medium opacity-90">
                    {statusFlash.playerName}
                  </div>
                )}

                {/* Show team name and amount for sold players */}
                {statusFlash.type === 'sold' && statusFlash.teamName && statusFlash.amount && (
                  <div className="text-sm font-medium opacity-90">
                    {statusFlash.teamName} • {formatCurrency(statusFlash.amount)}
                  </div>
                )}

                {/* Show team name and amount for new bids */}
                {statusFlash.type === 'new_bid' && statusFlash.teamName && statusFlash.amount && (
                  <div className="text-sm font-medium opacity-90">
                    {statusFlash.teamName} • {formatCurrency(statusFlash.amount)}
                  </div>
                )}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-8xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8 pb-20 safe-bottom">
        <div className={`grid gap-4 sm:gap-5 lg:gap-6 ${isAdmin ? 'grid-cols-12' : 'grid-cols-10'}`}>
          {/* Teams Panel - Only shown to admins */}
          {isAdmin && (
            <AdminTeamsPanel
              teams={teams ?? []}
              soldPlayers={soldPlayers}
              currentBidTeamId={currentBidTeam?._id}
              currentPlayer={currentPlayer}
              auctionRoomStatus={auctionRoom.status}
              isFirstBid={isFirstBid}
              minNextBid={minNextBid}
              maxPlayersPerTeam={auctionData.tournament?.settings.maxPlayersPerTeam || 15}
              tournamentBasePrice={auctionData.tournament?.settings.basePrice ?? 100000}
              minBidIncrement={auctionData.tournament?.settings.minBidIncrement || 25000}
              bidding={bidding}
              getCustomBidAmount={getCustomBidAmount}
              setCustomBidAmount={setCustomBidAmount}
              onBid={(teamId, amount) => handleBid(teamId as Id<"teams">, amount)}
            />
          )}

          {/* Center Stage */}
          <div className={`order-1 ${isAdmin ? 'col-span-12 lg:col-span-6 lg:order-2' : 'col-span-10 lg:col-span-7'}`}>
            {/* Timer - Cricket Ball Style - Admin only; viewers see it in the header */}
            {isAdmin && <div className="flex justify-center mb-4 sm:mb-6 lg:mb-8">
              <div className="relative w-24 h-24 sm:w-28 sm:h-28 lg:w-32 lg:h-32">
                {/* Glow effect */}
                <div className={`absolute inset-0 rounded-full blur-xl transition-colors ${displayTimeLeft <= 10 ? 'bg-red-500/30' : 'bg-orange-500/20'
                  }`} />
                <svg className="w-full h-full transform -rotate-90 relative z-10" viewBox="0 0 100 100">
                  {/* Background circle - cricket ball red */}
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    className="text-red-900/50"
                  />
                  {/* Progress circle */}
                  <motion.circle
                    cx="50"
                    cy="50"
                    r="45"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    className={displayTimeLeft <= 10 ? "text-red-500" : "text-orange-500"}
                    strokeDasharray={2 * Math.PI * 45}
                    strokeDashoffset={2 * Math.PI * 45 * (1 - displayTimeLeft / (auctionData.tournament?.settings.bidTimerSeconds || 30))}
                    strokeLinecap="round"
                    transition={{ duration: 0.1, ease: "linear" }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center z-20">
                  <div className="text-center">
                    <motion.div
                      className={`text-3xl sm:text-4xl lg:text-5xl font-bold ${displayTimeLeft <= 10 ? 'text-red-500' : 'text-orange-400'
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
            </div>}

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
                  {/* Viewer Mode: Enlarged horizontal layout */}
                  {!isAdmin ? (
                    <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 items-center">
                      {/* Large Player Photo */}
                      <div className="w-full max-w-70 sm:max-w-xs lg:w-auto lg:max-w-none mx-auto shrink-0">
                        <PlayerAvatar
                          name={currentPlayer.name}
                          photoUrl={currentPlayer.photoUrl}
                          size="3xl"
                          className="rounded-2xl w-full! h-auto! aspect-square"
                        />
                      </div>

                      {/* Player Details + Bid on the right */}
                      <div className="flex-1 w-full">
                        <div className="flex items-center justify-center lg:justify-start gap-3 mb-3 sm:mb-4">
                          {currentPlayer.playerNumber && (
                            <span className="inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-blue-600 text-white text-xl sm:text-2xl font-bold shadow-lg">
                              #{currentPlayer.playerNumber}
                            </span>
                          )}
                          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold">
                            {currentPlayer.name}
                          </h2>
                        </div>

                        <div className="flex flex-wrap justify-center lg:justify-start gap-2 sm:gap-3 mb-5 sm:mb-6">
                          <span className="px-4 py-2 bg-purple-600 rounded-full text-sm sm:text-base font-semibold">
                            {getRoleDisplay(currentPlayer.role)}
                          </span>
                          <span className="px-4 py-2 bg-slate-700 rounded-full text-sm sm:text-base">
                            {currentPlayer.age} years
                          </span>
                          <span className="px-4 py-2 bg-slate-700 rounded-full text-sm sm:text-base">
                            {currentPlayer.battingBowlingHand}
                          </span>
                        </div>

                        {/* Current Bid Display - Compact for viewer */}
                        <motion.div
                          className="bg-linear-to-r from-yellow-600 to-orange-600 rounded-xl p-4 sm:p-5 text-center"
                          animate={{ scale: [1, 1.01, 1] }}
                          transition={{ repeat: Infinity, duration: 2 }}
                        >
                          <div className="text-xs sm:text-sm font-semibold mb-1 opacity-90">
                            {isFirstBid ? "STARTING PRICE" : "CURRENT BID"}
                          </div>
                          <motion.div
                            className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-1"
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

                        {/* Player Info - inline for viewer */}
                        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3 text-center">
                          <div className="bg-slate-800/60 rounded-lg p-2 sm:p-3 border border-slate-700">
                            <div className="text-[10px] sm:text-xs text-slate-400 mb-0.5 sm:mb-1">Base</div>
                            <div className="text-xs sm:text-sm font-semibold">
                              {formatCurrency(currentPlayer.basePrice ?? auctionData?.tournament?.settings?.basePrice ?? 100000)}
                            </div>
                          </div>
                          <div className="bg-slate-800/60 rounded-lg p-2 sm:p-3 border border-slate-700">
                            <div className="text-[10px] sm:text-xs text-slate-400 mb-0.5 sm:mb-1">Next</div>
                            <div className="text-xs sm:text-sm font-semibold text-green-400">
                              {formatCurrency(isFirstBid ? (currentPlayer.basePrice ?? auctionData?.tournament?.settings?.basePrice ?? 100000) : minNextBid)}
                            </div>
                          </div>
                          <div className="bg-slate-800/60 rounded-lg p-2 sm:p-3 border border-slate-700">
                            <div className="text-[10px] sm:text-xs text-slate-400 mb-0.5 sm:mb-1">Bids</div>
                            <div className="text-xs sm:text-sm font-semibold">{auctionData?.totalBidsCount || 0}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Admin Mode: Original compact layout */
                    <>
                  <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 mb-4 sm:mb-6">
                    <PlayerAvatar
                      name={currentPlayer.name}
                      photoUrl={currentPlayer.photoUrl}
                      size="2xl"
                      className="rounded-xl sm:rounded-2xl mx-auto sm:mx-0"
                    />

                    <div className="flex-1 text-center sm:text-left">
                      <div className="flex items-center justify-center sm:justify-start gap-3 mb-2 sm:mb-3">
                        {currentPlayer.playerNumber && (
                          <span className="inline-flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-blue-600 text-white text-lg sm:text-xl font-bold shadow-lg">
                            #{currentPlayer.playerNumber}
                          </span>
                        )}
                        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold">
                          {currentPlayer.name}
                        </h2>
                      </div>

                      <div className="flex flex-wrap justify-center sm:justify-start gap-2 mb-3 sm:mb-4">
                        <span className="px-3 sm:px-4 py-1.5 sm:py-2 bg-purple-600 rounded-full text-xs sm:text-sm font-semibold">
                          {getRoleDisplay(currentPlayer.role)}
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
                    </>
                  )}
                </motion.div>
              ) : (
                <div className="text-center py-12 sm:py-16 lg:py-20 text-slate-400">
                  <Trophy className="w-14 h-14 sm:w-16 sm:h-16 lg:w-20 lg:h-20 mx-auto mb-3 sm:mb-4 opacity-50" />
                  {isAdmin ? (
                    <p className="text-base sm:text-lg lg:text-xl mb-4">
                      Click &quot;Next Player&quot; to start auction
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-base sm:text-lg lg:text-xl">
                        Waiting for next player...
                      </p>
                      <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span>Live auction in progress</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* Viewer Team Panel - right side on desktop */}
          {!isAdmin && (
            <ViewerTeamsPanel
              teams={teams ?? []}
              soldPlayers={soldPlayers}
              maxPlayersPerTeam={auctionData.tournament?.settings.maxPlayersPerTeam || 15}
              currentBidTeamId={currentBidTeam?._id}
            />
          )}

          {/* Live Feed - Side panel for admin */}
          {isAdmin ? (
            <AuctionLiveBids
              recentBids={recentBids}
              teams={teams}
              currentPlayer={currentPlayer}
              isFirstBid={isFirstBid}
              minNextBid={minNextBid}
              totalBidsCount={auctionData?.totalBidsCount || 0}
              tournamentBasePrice={auctionData.tournament?.settings.basePrice ?? 100000}
            />
          ) : null}
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
          tournamentLogoUrl={auctionData.tournament?.logoUrl}
          amount={result.amount}
          sold={result.sold}
          teamColor={result.teamColor}
          avatarSize={isAdmin ? 'xl' : '2xl'}
          interactive={isAdmin}
          onClose={async () => {
            setShowResult(false);
            // Only admins auto-advance to the next player
            if (isAdmin) {
              setTimeout(async () => {
                if (
                  auctionData?.auctionRoom?.status === 'live' &&
                  (auctionData?.stats?.pending > 0 || auctionData?.stats?.unsold > 0 || auctionData?.stats?.inAuction > 0)
                ) {
                  await handleNextPlayer();
                }
              }, 100);
            }
          }}
        />
      )}

      {/* Player Introduction Flash */}
      {currentPlayer && (
        <PlayerIntroFlash
          show={showPlayerIntro}
          player={currentPlayer}
          tournamentBasePrice={auctionData.tournament?.settings.basePrice ?? 100000}
        />
      )}

      {/* Live Stats Crawler/Ticker — memoized to avoid re-renders on timer/bid changes */}
      {!isAdmin && <TickerBar teams={teams} soldPlayers={soldPlayers} />}

    
      {/* Admin Player Manager Modal */}
      {showPlayerManager && auctionData.tournament && (
        <AdminPlayerManager
          tournamentId={auctionData.tournament._id}
          maxPlayersPerTeam={auctionData.tournament.settings.maxPlayersPerTeam}
          tournamentBasePrice={auctionData.tournament.settings.basePrice ?? 100000}
          onClose={() => setShowPlayerManager(false)}
        />
      )}
    </div>
  );
}

// Memoized Ticker Bar — only re-renders when teams or soldPlayers change, not on timer/bid updates
interface TickerBarProps {
  teams: Array<{
    _id: string;
    name: string;
    colorPrimary: string;
    [key: string]: unknown;
  }>;
  soldPlayers: Array<{ _id: string; name: string; soldPrice?: number; teamId?: string; [key: string]: unknown }> | undefined;
}

const TickerBar = React.memo(function TickerBar({ teams, soldPlayers }: TickerBarProps) {
  const tickerContent = useMemo(() => {
    if (!soldPlayers || !teams) return [];
    // Last 10 sold players in query order (no sale timestamp available; order is not guaranteed to reflect recency)
    const sold = [...soldPlayers].filter(p => p.soldPrice && p.soldPrice > 0).slice(-10).reverse();
    return sold.map(p => {
      const team = teams.find(t => t._id === p.teamId);
      return { ...p, teamName: team?.name, teamColor: team?.colorPrimary };
    });
  }, [soldPlayers, teams]);

  if (tickerContent.length === 0) {
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-linear-to-r from-slate-900 via-slate-800 to-slate-900 border-t-2 border-slate-600 py-3 sm:py-4 z-40 overflow-hidden">
        <div className="flex items-center justify-center text-slate-500 text-sm">
          No players sold yet
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-linear-to-r from-slate-900 via-slate-800 to-slate-900 border-t-2 border-slate-600 py-3 sm:py-4 z-40 overflow-hidden">
      <div className="relative flex items-center">
        <div className="absolute left-0 w-8 sm:w-16 h-full bg-linear-to-r from-slate-900 to-transparent z-10" />
        <div className="absolute right-0 w-8 sm:w-16 h-full bg-linear-to-l from-slate-900 to-transparent z-10" />
        <motion.div
          className="flex gap-4 sm:gap-6 px-4 sm:px-8 whitespace-nowrap"
          animate={{ x: ["0%", "-50%"] }}
          transition={{ x: { repeat: Infinity, repeatType: "loop", duration: Math.max(15, tickerContent.length * 4), ease: "linear" } }}
        >
          {[...Array(2)].map((_, loopIndex) => (
            <div key={loopIndex} className="flex gap-4 sm:gap-6">
              {tickerContent.map((player) => (
                <div
                  key={`${loopIndex}-${player._id}`}
                  className="flex items-center gap-2 sm:gap-3 bg-slate-800/60 rounded-full px-4 sm:px-5 py-2 border border-slate-600 shrink-0"
                >
                  <span className="font-semibold text-white text-sm sm:text-base">{player.name as string}</span>
                  <span className="text-slate-400 text-sm">•</span>
                  <span className="text-yellow-400 font-bold text-sm sm:text-base">{formatCurrency(player.soldPrice || 0)}</span>
                  {player.teamName && (
                    <>
                      <span className="text-slate-400 text-sm">→</span>
                      <span className="text-sky-300 text-sm sm:text-base">{player.teamName}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
});