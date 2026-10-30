// app/(app)/auction/[roomId]/page.tsx
"use client";

import { use, useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy,
  Users, Gavel, RotateCcw, RotateCw, Play, Pause, RefreshCcw,
  Eye, Settings2, UserX, AlertTriangle, LogIn
} from 'lucide-react';
import { Logo } from '@/components/ds/logo';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { formatCurrency, getErrorMessage, getRoleDisplay } from '@/lib/utils';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { ImgWithFallback } from '@/components/ui/img-with-fallback';
import { useUserRole } from '@/hooks/useUserRole';
import { useTournamentRole } from '@/hooks/useTournamentRole';
import { useConfirm } from '@/components/ui/confirm-dialog';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { PlayerIntroFlash } from '@/components/auction/PlayerIntroFlash';
import { ViewerActionBar, ViewerSheets, type ViewerSheetType } from '@/components/auction/ViewerPanels';
import { AuctionLiveBids } from '@/components/auction/AuctionLiveBids';
import { AdminTeamsPanel } from '@/components/auction/AdminTeamsPanel';
import { OwnerPaddle } from '@/components/auction/OwnerPaddle';
import { IncomingRaisesTray } from '@/components/auction/IncomingRaisesTray';
import { ConnectionStatus } from '@/components/ui/connection-status';
import { ReconciliationBadge } from '@/components/auction/ReconciliationBadge';
import { BidTimerRing } from '@/components/auction/BidTimerRing';
import { GoingOnceHelper } from '@/components/auction/GoingOnceHelper';
import { useBidCountdown } from '@/hooks/useBidCountdown';
import { BroadcastMenu } from '@/components/broadcast/BroadcastMenu';
import { CategoryChip } from '@/components/players/CategoryChip';
import { applyOptimisticBid, newRequestId } from '@/lib/optimisticBid';
import { ownerInsights } from '@/lib/insights';
import { SetBanner } from '@/components/auction/SetBanner';
import { ConsoleMoreMenu } from '@/components/auction/ConsoleMoreMenu';
import { bidTimerSeconds, categoryFor, incrementFor } from '@/convex/bidRules';

// Lazy-load heavy components that are only used conditionally
const PlayerResultPopup = dynamic(() => import('@/components/auction/PlayerResultPopup').then(m => ({ default: m.PlayerResultPopup })), { ssr: false });
const AuctionCompleteScreen = dynamic(() => import('@/components/auction/AuctionCompleteScreen').then(m => ({ default: m.AuctionCompleteScreen })), { ssr: false });
const AdminPlayerManager = dynamic(() => import('@/components/auction/AdminPlayerManager').then(m => ({ default: m.AdminPlayerManager })), { ssr: false });

interface AuctionPageProps {
  params: Promise<{ roomId: string }>;
}

// Minimum time the SOLD/UNSOLD result popup stays up before the next player is
// allowed to override it — so viewers always see the outcome (esp. UNSOLD).
const MIN_RESULT_DISPLAY_MS = 2500;

// How long the "Now: <set>" banner stays up (matches the unsold-round banner).
const SET_BANNER_MS = 3000;

export default function AuctionPage({ params }: AuctionPageProps) {
  const { roomId } = use(params);
  const auctionRoomId = roomId as Id<"auctionRooms">;

  // Signed-out visitors are plain viewers.
  const { isSignedIn } = useUserRole();
  const confirm = useConfirm();

  // Which viewer sheet (sold / unsold / teams history) is open, if any.
  const [activeSheet, setActiveSheet] = useState<ViewerSheetType | null>(null);

  // Convex queries and mutations
  // Split into a HOT query (room + live bids, re-sent on every bid/timer) and a
  // COLD query (full roster, only re-sent on sale/player-change). The roster is
  // keyed on tournamentId + currentPlayerId from the hot query so per-bid room
  // patches don't invalidate it — critical for 150+ concurrent viewers.
  const liveData = useQuery(api.auctions.getLiveAuction, {
    auctionRoomId
  });
  const rosterData = useQuery(
    api.auctions.getAuctionRoster,
    liveData
      ? {
          tournamentId: liveData.auctionRoom.tournamentId,
          currentPlayerId: liveData.auctionRoom.currentPlayerId,
        }
      : 'skip'
  );

  // Console vs viewer is per tournament: its owners and auctioneers (and the
  // super-admin) get the console; everyone else, including other organisers,
  // watches. The tournament id arrives with the hot query.
  const {
    canRunAuction: isConsole,
    canManage,
    isLoading: isRoleLoading,
  } = useTournamentRole(liveData?.auctionRoom.tournamentId);

  // Latest SOLD/UNSOLD event — authoritative trigger + data for the viewer
  // result popup (replaces the racy client-side ref reconstruction). Skipped
  // for admins, who drive the popup directly from finalizePlayerSale.
  const latestSaleEvent = useQuery(
    api.auctions.getLatestSaleEvent,
    isConsole ? 'skip' : { auctionRoomId },
  );

  // Owner paddle — per-identity, so only signed-in non-admins subscribe.
  // Anonymous viewers never touch it; it returns null for non-owners.
  const paddle = useQuery(
    api.auctions.getMyPaddle,
    isSignedIn && !isConsole && !isRoleLoading ? { auctionRoomId } : 'skip',
  );

  // Sold/unsold history — fetched lazily, only while a history sheet is open.
  const auctionHistory = useQuery(
    api.auctions.getAuctionHistory,
    (activeSheet === 'sold' || activeSheet === 'unsold') && liveData
      ? { tournamentId: liveData.auctionRoom.tournamentId }
      : 'skip',
  );

  // Merge the two query results into the single shape the rest of the page expects.
  const auctionData = useMemo(() => {
    if (liveData === undefined) return undefined;
    if (liveData === null) return null;
    const currentPlayer = rosterData?.currentPlayer ?? null;
    const tournament = rosterData?.tournament ?? null;
    const tournamentBasePrice = tournament?.settings?.basePrice ?? 100000;
    const currentBidAmount =
      liveData.currentBidAmount ??
      (currentPlayer ? (currentPlayer.basePrice ?? tournamentBasePrice) : undefined);
    return {
      auctionRoom: {
        ...liveData.auctionRoom,
        currentBidAmount,
        currentBidTeamId: liveData.currentBidTeamId,
      },
      currentPlayer,
      currentBidTeam: liveData.currentBidTeam,
      recentBids: liveData.recentBids,
      totalBidsCount: liveData.totalBidsCount,
      serverTime: liveData.serverTime,
      teams: rosterData?.teams ?? [],
      tournament,
      soldPlayers: rosterData?.soldPlayers ?? [],
      minBasePrice: rosterData?.minBasePrice,
      stats: rosterData?.stats ?? {
        total: 0,
        pending: 0,
        sold: 0,
        unsold: 0,
        inAuction: 0,
      },
    };
  }, [liveData, rosterData]);

  // Optimistic: the console shows the bid the moment it's tapped. Convex drops
  // the guess when placeBid returns, so a rejected bid rolls back by itself.
  const placeBid = useMutation(api.auctions.placeBid).withOptimisticUpdate((store, args) => {
    const live = store.getQuery(api.auctions.getLiveAuction, { auctionRoomId: args.auctionRoomId });
    if (!live?.auctionRoom.currentPlayerId) return;
    const roster = store.getQuery(api.auctions.getAuctionRoster, {
      tournamentId: live.auctionRoom.tournamentId,
      currentPlayerId: live.auctionRoom.currentPlayerId,
    });
    const team = roster?.teams.find((t) => t._id === args.teamId) ?? null;
    store.setQuery(
      api.auctions.getLiveAuction,
      { auctionRoomId: args.auctionRoomId },
      applyOptimisticBid(live, args, team, Date.now()),
    );
  });
  const finalizePlayer = useMutation(api.auctions.finalizePlayerSale);
  const markFinalUnsold = useMutation(api.auctions.markPlayerFinalUnsold);
  const startNext = useMutation(api.auctions.startNextPlayer);
  const revertBid = useMutation(api.auctions.revertLastBid);
  const restartCurrentPlayer = useMutation(api.auctions.restartCurrentPlayer);
  const startAuction = useMutation(api.auctions.startAuction);
  const pauseAuction = useMutation(api.auctions.pauseAuction);
  const resumeAuction = useMutation(api.auctions.resumeAuction);
  const restartAuction = useMutation(api.auctions.restartAuction);
  const resolveStalledRound = useMutation(api.auctions.resolveStalledRound);

  // The player and top bid this console is showing (optimistic bids included,
  // since this client's mutations apply in order). Sent with every console
  // action so a stale one is refused instead of landing on the next player.
  const expectedState = useCallback(() => ({
    expectedPlayerId: liveData?.auctionRoom.currentPlayerId,
    expectedCurrentBid: liveData?.currentBidAmount ?? null,
  }), [liveData]);

  const [bidding, setBidding] = useState<Id<"teams"> | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [customBidAmounts, setCustomBidAmounts] = useState<Record<string, number>>({});
  const [showPlayerIntro, setShowPlayerIntro] = useState(false);
  const [showPlayerManager, setShowPlayerManager] = useState(false);
  const [showUnsoldRoundBanner, setShowUnsoldRoundBanner] = useState(false);
  // "Now: Marquee set" (presentationOrder by_category): the set id announced.
  const [setBannerId, setSetBannerId] = useState<string | null>(null);
  const [resolvingStall, setResolvingStall] = useState(false);
  const lastPlayerIdRef = useRef<string | null>(null);
  const introTimerRef = useRef<NodeJS.Timeout | null>(null);
  const loadingNextRef = useRef(false);
  const prevPhaseRef = useRef<string | null>(null);
  const unsoldBannerTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Last room.currentSetId seen; `undefined` = not loaded yet, so a viewer who
  // joins mid-set isn't shown a stale banner.
  const prevSetIdRef = useRef<string | null | undefined>(undefined);
  const setBannerTimerRef = useRef<NodeJS.Timeout | null>(null);
  // The "Unsold Round" banner must appear at most once per auction.
  const hasShownUnsoldBannerRef = useRef(false);
  // Enforces MIN_RESULT_DISPLAY_MS for the result popup.
  const resultShownAtRef = useRef<number>(0);
  const resultCloseTimerRef = useRef<NodeJS.Timeout | null>(null);

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
  // Last SOLD/UNSOLD event id already shown to this viewer. `undefined` means
  // "not initialised yet" so late-joiners don't get a stale popup on first load.
  const lastSaleEventIdRef = useRef<string | null | undefined>(undefined);

  const [result, setResult] = useState<{
    playerName: string;
    playerPhotoUrl?: string;
    teamName: string | null;
    teamLogoUrl?: string;
    amount: number;
    sold: boolean;
    teamColor?: string;
  } | null>(null);
  const handleFinalize = useCallback(async () => {
    if (!isConsole) return; // Only admins can finalize
    if (showResult) return; // Prevent finalizing twice for the same player
    // Capture current bid state BEFORE calling finalize mutation
    const hadBidder = Boolean(auctionData?.currentBidTeam);
    const bidAmount = auctionData?.auctionRoom?.currentBidAmount ?? 0;
    const bidderTeam = auctionData?.currentBidTeam;
    const playerName = auctionData?.currentPlayer?.name ?? '';
    const playerPhotoUrl = auctionData?.currentPlayer?.photoUrl;
    try {
      // requestId: a retried finalize (dropped socket) settles only once.
      const res = (await finalizePlayer({ auctionRoomId, requestId: newRequestId(), ...expectedState() })) as {
        playerName?: string;
        teamName?: string | null;
        amount?: number;
        sold?: boolean;
        success?: boolean;
        reason?: string;
      } | null;

      // Another admin tab already finalized this player — silently ignore.
      if (res && !res.success && res.reason === "No player in auction") return;
      // Any other refusal (e.g. the winning team can no longer afford the bid)
      // means nothing was sold — surface it instead of showing a result.
      if (res && !res.success) {
        toast.error(res.reason ?? 'Could not finalize this player');
        return;
      }

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
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to finalize"));
    }
  }, [isConsole, showResult, finalizePlayer, auctionRoomId, auctionData, expectedState]);

  // Advisory bid countdown, ticked locally from the hot query's
  // bidTimerEndsAt + serverTime. Never auto-finalises.
  const tournamentSettings = rosterData?.tournament?.settings;
  const countdown = useBidCountdown({
    endsAt: liveData?.auctionRoom.bidTimerEndsAt,
    serverTime: liveData?.serverTime,
    status: liveData?.auctionRoom.status,
    pausedTimeRemaining: liveData?.auctionRoom.pausedTimeRemaining,
    timerSeconds: tournamentSettings ? bidTimerSeconds(tournamentSettings) : undefined,
    hasCurrentPlayer: Boolean(rosterData?.currentPlayer),
  });

  // Flash a big "Unsold Players Auction" banner when the auction transitions
  // from the main round into the unsold round (for everyone watching live).
  useEffect(() => {
    const phase = auctionData?.auctionRoom?.auctionPhase ?? null;
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    // Fire once, only on the live transition from the main round into the
    // unsold round. (A viewer who joins when the phase is already "unsold"
    // starts with prev = null and never sees it — which is intended.)
    if (prev && prev !== 'unsold' && phase === 'unsold' && !hasShownUnsoldBannerRef.current) {
      hasShownUnsoldBannerRef.current = true;
      const raf = requestAnimationFrame(() => setShowUnsoldRoundBanner(true));
      if (unsoldBannerTimerRef.current) clearTimeout(unsoldBannerTimerRef.current);
      unsoldBannerTimerRef.current = setTimeout(() => setShowUnsoldRoundBanner(false), 3000);
      return () => cancelAnimationFrame(raf);
    }
  }, [auctionData?.auctionRoom?.auctionPhase]);

  // Announce each new category set, for everyone watching. The admin's
  // auto-loader holds off while it is up, as for the unsold-round banner.
  const currentSetId = liveData?.auctionRoom.currentSetId ?? null;
  const liveLoaded = liveData !== undefined;
  useEffect(() => {
    if (!liveLoaded) return;
    const prev = prevSetIdRef.current;
    prevSetIdRef.current = currentSetId;
    if (prev === undefined || !currentSetId || currentSetId === prev) return;
    const raf = requestAnimationFrame(() => setSetBannerId(currentSetId));
    if (setBannerTimerRef.current) clearTimeout(setBannerTimerRef.current);
    setBannerTimerRef.current = setTimeout(() => setSetBannerId(null), SET_BANNER_MS);
    return () => cancelAnimationFrame(raf);
  }, [liveLoaded, currentSetId]);

  useEffect(() => () => {
    if (setBannerTimerRef.current) clearTimeout(setBannerTimerRef.current);
    if (unsoldBannerTimerRef.current) clearTimeout(unsoldBannerTimerRef.current);
    if (resultCloseTimerRef.current) clearTimeout(resultCloseTimerRef.current);
  }, []);

  // Timestamp each time the result popup becomes visible, so we can hold it up
  // for a minimum duration before the next player is allowed to replace it.
  useEffect(() => {
    if (showResult) resultShownAtRef.current = Date.now();
  }, [showResult]);

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
        // Don't let the incoming player instantly wipe the SOLD/UNSOLD result —
        // hold it for at least MIN_RESULT_DISPLAY_MS from when it appeared.
        if (resultCloseTimerRef.current) clearTimeout(resultCloseTimerRef.current);
        const remaining = MIN_RESULT_DISPLAY_MS - (Date.now() - resultShownAtRef.current);
        if (remaining <= 0) {
          setShowResult(false);
        } else {
          resultCloseTimerRef.current = setTimeout(() => setShowResult(false), remaining);
        }
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
    if (isConsole) return; // Only for viewers

    const currentStatus = auctionData?.auctionRoom?.status;
    // Use the true bid count, not recentBids.length — the latter is capped at 10
    // by getLiveAuction, so new-bid/revert/rebid flashes silently stopped firing
    // once a player drew >10 bids. (P1-6)
    const currentBidCount = auctionData?.totalBidsCount ?? 0;
    const currentPlayerIdNow = auctionData?.auctionRoom?.currentPlayerId;

    let flashToShow: typeof statusFlash = null;

    // When the current player clears, a sale was just finalized — the SOLD/UNSOLD
    // popup is driven by the latestSaleEvent effect below. Skip banner detection
    // for this tick so the bid-count dropping to 0 doesn't fire a spurious
    // "reverted" banner on top of the sale popup.
    const playerJustCleared =
      Boolean(prevCurrentPlayerIdRef.current) && !currentPlayerIdNow;

    if (!playerJustCleared) {
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
    }

    // Update refs
    prevAuctionStatusRef.current = currentStatus ?? null;
    prevBidCountRef.current = currentBidCount;
    prevCurrentPlayerIdRef.current = currentPlayerIdNow ?? null;

    if (!flashToShow) return;
    const rafFlash = requestAnimationFrame(() => {
      showStatusFlash(flashToShow);
    });
    return () => cancelAnimationFrame(rafFlash);
  }, [isConsole, auctionData?.auctionRoom?.status, auctionData?.recentBids, auctionData?.totalBidsCount, auctionData?.auctionRoom?.currentPlayerId, auctionData?.teams, showStatusFlash]);

  // Viewer SOLD/UNSOLD result popup — driven by the authoritative server sale
  // event (getLatestSaleEvent) rather than reconstructing the result from
  // client-side ref timing across the separately-updating hot/cold queries.
  useEffect(() => {
    if (isConsole) return;
    if (latestSaleEvent === undefined) return; // still loading

    const ev = latestSaleEvent; // null when no sale has happened yet
    const eventId = ev?.eventId ?? null;

    // First load: record the current event without showing it, so a viewer who
    // joins mid-auction doesn't get a popup for a sale that already happened.
    if (lastSaleEventIdRef.current === undefined) {
      lastSaleEventIdRef.current = eventId;
      return;
    }

    if (!ev || eventId === lastSaleEventIdRef.current) return;
    lastSaleEventIdRef.current = eventId;

    const raf = requestAnimationFrame(() => {
      setActiveSheet(null); // a sale takes focus — close any open history/teams sheet
      setResult({
        playerName: ev.playerName,
        playerPhotoUrl: ev.playerPhotoUrl,
        teamName: ev.teamName,
        teamLogoUrl: ev.teamLogoUrl,
        amount: ev.amount,
        sold: ev.sold,
        teamColor: ev.teamColor,
      });
      setShowResult(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [isConsole, latestSaleEvent]);

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

    setBidding(teamId);

    // Clear bidding state after a short delay (allows quick successive bids from different teams)
    setTimeout(() => setBidding(null), 300);

    try {
      const res = await placeBid({
        auctionRoomId,
        teamId,
        amount,
        // One id per tap: a retry of this same bid can never land twice.
        requestId: newRequestId(),
        ...expectedState(),
      });

      if (res && typeof res === 'object' && 'success' in res) {
        if (!res.success) {
          toast.error(res.reason || 'Bid rejected');
        }
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to place bid"));
    }
  }, [bidding, auctionData?.auctionRoom?.status, placeBid, auctionRoomId, expectedState]);


  const handleNextPlayer = useCallback(async () => {
    // Guard against overlapping loads (auto-loader effect + subscription lag).
    if (loadingNextRef.current) return;
    loadingNextRef.current = true;
    try {
      // startNextPlayer returns a discriminated union of round outcomes; read
      // the fields we care about off a widened shape.
      const res = (await startNext({ auctionRoomId })) as {
        success: boolean;
        completed?: boolean;
        reason?: string;
        stalled?: boolean;
        enteredUnsoldRound?: boolean;
      };

      if (res.success === false) {
        // "already in auction" means a concurrent load won the race — benign.
        if (res.reason && !res.reason.includes("already in auction")) {
          toast.error(res.reason);
        }
      } else if (res.completed) {
        toast.success("Auction completed! All players have been auctioned.");
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load next player"));
    } finally {
      loadingNextRef.current = false;
    }
  }, [startNext, auctionRoomId]);

  const handleRevertBid = useCallback(async () => {
    const expected = expectedState();
    if (!(await confirm({
      title: "Revert the last bid?",
      description: "The most recent bid will be removed from this player.",
      confirmText: "Revert Bid",
    }))) return;

    try {
      const res = await revertBid({ auctionRoomId, ...expected });
      if (!res.success) {
        toast.error(res.reason);
        return;
      }
      toast.success("Last bid reverted successfully");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to revert bid"));
    }
  }, [revertBid, auctionRoomId, confirm, expectedState]);

  const handleFinalUnsold = useCallback(async () => {
    const { expectedPlayerId } = expectedState();
    if (!(await confirm({
      title: "Mark player as FINAL UNSOLD?",
      description:
        "They will be removed from the auction and won't play for any team. They won't be auctioned again unless you restore them from Manage Players.",
      confirmText: "Mark Final Unsold",
    })))
      return;

    try {
      const res = await markFinalUnsold({ auctionRoomId, expectedPlayerId });
      if (res.success === false) {
        toast.error(res.reason || "Could not mark player as final unsold");
      } else {
        toast.success(`${res.playerName ?? "Player"} marked as final unsold`);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to mark player as final unsold"));
    }
  }, [markFinalUnsold, auctionRoomId, confirm, expectedState]);

  // Resolve a stalled unsold round (infinite-loop guard). The backend clears
  // `roundStalled`, which reactively hides the modal on every client.
  const handleResolveStall = useCallback(
    async (action: 'continue' | 'finalizeUnsold' | 'end') => {
      setResolvingStall(true);
      try {
        await resolveStalledRound({ auctionRoomId, action });
        toast.success(
          action === 'continue' ? 'Starting another unsold round' : 'Auction ended',
        );
      } catch (error) {
        toast.error(getErrorMessage(error, 'Failed to resolve the round'));
      } finally {
        setResolvingStall(false);
      }
    },
    [resolveStalledRound, auctionRoomId],
  );

  // Auto-load the next player whenever the auction is live with no one in the
  // ring and no result popup open. This replaces the manual "Next" button:
  // covers the first player after Start, advancing after each sale, and
  // resuming a live room that has no current player.
  useEffect(() => {
    if (!isConsole) return;
    if (auctionData?.auctionRoom?.status !== 'live') return;
    if (auctionData?.auctionRoom?.currentPlayerId) return;
    if (showResult) return;
    // While the "Unsold Round" banner is up, hold off loading the next player
    // so it isn't overridden — the first unsold player loads once it clears.
    if (showUnsoldRoundBanner) return;
    // Same for the "Now: <set>" banner; currentSetId is a dependency so a new
    // set always re-arms the loader even if the banner never shows.
    if (setBannerId) return;
    // A stalled round is awaiting an admin decision — don't loop into it.
    if (auctionData?.auctionRoom?.roundStalled) return;
    const t = setTimeout(() => { handleNextPlayer(); }, 200);
    return () => clearTimeout(t);
  }, [isConsole, auctionData?.auctionRoom?.status, auctionData?.auctionRoom?.currentPlayerId, showResult, showUnsoldRoundBanner, setBannerId, currentSetId, auctionData?.auctionRoom?.roundStalled, handleNextPlayer]);

  // Wait for both the hot payload and the initial roster before first paint so
  // teams/current-player aren't momentarily empty. Subsequent bid/timer updates
  // only touch `liveData`, so the roster stays warm and never re-triggers this.
  if (!auctionData || rosterData === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  const { auctionRoom, currentPlayer, currentBidTeam, teams, recentBids, soldPlayers } = auctionData;

  // Only show the role pill when a role is actually set — otherwise the coloured
  // badge appears empty on the player card.
  const roleDisplay = currentPlayer ? getRoleDisplay(currentPlayer.role).trim() : '';

  // Show auction complete screen when auction is completed
  if (auctionRoom.status === 'completed') {
    return (
      <AuctionCompleteScreen
        isAdmin={canManage}
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
  // Increment comes from the price band the current bid sits in (slabs), or
  // the flat minBidIncrement when the tournament has none.
  const minBidIncrement = auctionData.tournament?.settings.minBidIncrement || 25000;
  const bidIncrement = incrementFor(currentBid, auctionData.tournament?.settings.incrementSlabs, minBidIncrement);
  const minNextBid = currentBid + bidIncrement;

  const isFirstBid = !recentBids || recentBids.length === 0;

  // Auction progress counter ("X / N") + round label. Main round counts every
  // player put up (total minus those still pending). Unsold rounds count the
  // queue cursor against that round's queue length. Round number: 1 = main,
  // 2 = first unsold round, … shown as "Unsold Round {roundNumber - 1}".
  const isUnsoldRound = auctionRoom.auctionPhase === 'unsold';
  const roundNumber = auctionRoom.roundNumber ?? 1;
  const roundLabel = isUnsoldRound
    ? `Unsold Round ${Math.max(1, roundNumber - 1)}`
    : 'Main Round';
  const stats = auctionData.stats;
  const progressTotal = isUnsoldRound
    ? (auctionRoom.unsoldRoundTotal ?? auctionRoom.unsoldQueue?.length ?? 0)
    : (stats?.total ?? 0);
  const progressCurrent = isUnsoldRound
    ? Math.min(progressTotal, Math.max(0, auctionRoom.unsoldCursor ?? 0))
    : Math.max(0, (stats?.total ?? 0) - (stats?.pending ?? 0));
  const showProgress = Boolean(currentPlayer) && progressTotal > 0;
  const isRoundStalled = Boolean(auctionRoom.roundStalled);

  return (
    <div className={`${isConsole ? 'min-h-screen' : 'h-[100dvh] flex flex-col'} bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white relative overflow-hidden`}>
      {/* Reconnecting indicator — surfaces silent socket drops (P1-1) */}
      <ConnectionStatus />

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
      <header className="shrink-0 border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50 safe-top">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              {/* Tournament Logo — ImgWithFallback auto-recovers if the URL changes */}
              <div className="relative">
                <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl overflow-hidden border-2 border-yellow-500/50 shadow-lg shadow-yellow-500/20">
                  <ImgWithFallback
                    src={auctionData.tournament?.logoUrl}
                    alt={auctionData.tournament?.name ?? 'Tournament'}
                    className="w-full h-full object-cover"
                    fallback={
                      <div className="w-full h-full bg-linear-to-br from-yellow-500 to-orange-600 flex items-center justify-center">
                        <Trophy className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                      </div>
                    }
                  />
                </div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 bg-green-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                  <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-white rounded-full animate-pulse" />
                </div>
              </div>
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
              {isConsole && (
                <ReconciliationBadge tournamentId={auctionRoom.tournamentId} />
              )}
            </div>

            {/* Admin Controls - Only visible to admins */}
            {isConsole ? (
              <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                {/* — Bid controls — */}
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
                    const { expectedPlayerId } = expectedState();
                    if (!(await confirm({
                      title: "Restart bidding for this player?",
                      description: "All bids placed on the current player will be cleared.",
                      confirmText: "Restart Bidding",
                    }))) return;
                    try {
                      const res = await restartCurrentPlayer({ auctionRoomId, expectedPlayerId });
                      if (!res.success) {
                        toast.error(res.reason);
                        return;
                      }
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

                <span aria-hidden className="hidden lg:block w-px h-7 self-center bg-slate-700/70 mx-0.5" />

                {/* — Auction state — */}
                {/* Start/Pause/Resume buttons based on status */}
                {auctionRoom.status === 'waiting' && (
                  <Button
                    onClick={async () => {
                      try {
                        await startAuction({ auctionRoomId });
                        // The auto-loader effect picks up the first player once the
                        // room goes live — no manual "Next" needed.
                        toast.success('Auction started!');
                      } catch (error) {
                        toast.error(getErrorMessage(error, 'Failed to start auction'));
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

                {/* Restart Auction Button — owners only (restartAuction is OWNER_ONLY) */}
                {canManage && (
                <Button
                  onClick={async () => {
                    if (!(await confirm({
                      title: "Restart the entire auction?",
                      description: "This will reset ALL players, team purses, and bid history. This action cannot be undone.",
                      confirmText: "Restart Auction",
                    }))) return;
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
                )}

                <span aria-hidden className="hidden lg:block w-px h-7 self-center bg-slate-700/70 mx-0.5" />

                {/* — Management — */}
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

                {/* OBS / vMix overlay URLs */}
                <BroadcastMenu auctionRoomId={auctionRoomId} />

                {/* Rare, destructive actions that need a reason */}
                <ConsoleMoreMenu
                  auctionRoomId={auctionRoomId}
                  currentPlayerName={currentPlayer?.name ?? null}
                  bidCount={auctionData.totalBidsCount ?? 0}
                />

                {/* Final Unsold: only during the second (unsold) round, once the
                    pending pool is exhausted. Grouped with management (kept away
                    from the primary Finalize action to avoid mis-taps). */}
                {auctionData.stats?.pending === 0 && (
                  <Button
                    onClick={handleFinalUnsold}
                    disabled={!currentPlayer || auctionRoom.status !== 'live'}
                    variant="outline"
                    size="lg"
                    title="Remove this player from the auction (won't play for any team)"
                    className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300 h-10 sm:h-11 px-2.5 sm:px-4 text-sm touch-target"
                  >
                    <UserX className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2" />
                    <span className="hidden sm:inline">Final Unsold</span>
                  </Button>
                )}

                {/* View Teams */}
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

                <span aria-hidden className="hidden lg:block w-px h-7 self-center bg-slate-700/70 mx-0.5" />

                {/* — Primary action: Finalize — larger and set apart from the rest */}
                <Button
                  onClick={handleFinalize}
                  disabled={!currentPlayer || auctionRoom.status !== 'live'}
                  size="lg"
                  title="Finalize the current player (SOLD / UNSOLD)"
                  className="bg-green-600 hover:bg-green-700 text-white font-bold h-11 sm:h-12 px-4 sm:px-6 text-sm sm:text-base shadow-lg shadow-green-900/30 ring-1 ring-green-400/30 touch-target"
                >
                  <Gavel className="w-5 h-5 sm:w-6 sm:h-6 sm:mr-2" />
                  <span className="hidden sm:inline">Finalize</span>
                </Button>
              </div>
            ) : (
              /* Viewer Mode: Bid11Pro Branding */
              <div className="flex items-center gap-3 sm:gap-5">
                {/* Bid11Pro Branding */}
                <div className="hidden sm:flex flex-col gap-1">
                  <Logo size="sm" />
                  {auctionData.tournament?.settings?.footerText && (
                    <span className="text-[10px] sm:text-[11px] text-slate-400 leading-tight">
                      {auctionData.tournament.settings.footerText}
                    </span>
                  )}
                </div>

                {/* Viewer badge */}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-500/10 rounded-lg border border-blue-500/30">
                  <Eye className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-medium text-blue-300">Viewer</span>
                </div>

                {/* Organisers on a public link can sign in to get admin controls */}
                {!isRoleLoading && !isSignedIn && (
                  <Link
                    href={`/sign-in?redirect_url=${encodeURIComponent(`/auction/${roomId}`)}`}
                    className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-white transition-colors"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    Sign in
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Viewer Status Flash Notification */}
      <AnimatePresence>
        {!isConsole && statusFlash && (
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

      <main className={`w-full max-w-8xl mx-auto px-3 sm:px-4 lg:px-6 safe-bottom ${isConsole ? 'py-4 sm:py-6 lg:py-8 pb-20' : `flex-1 min-h-0 overflow-y-auto flex flex-col py-3 sm:py-4 ${paddle ? 'pb-80' : 'pb-28 sm:pb-32'}`}`}>
        <div className={isConsole ? 'grid gap-4 sm:gap-5 lg:gap-6 grid-cols-12' : 'w-full my-auto'}>
          {/* Teams Panel - Only shown to admins */}
          {isConsole && (
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
              minBidIncrement={bidIncrement}
              bidding={bidding}
              getCustomBidAmount={getCustomBidAmount}
              setCustomBidAmount={setCustomBidAmount}
              onBid={(teamId, amount) => handleBid(teamId as Id<"teams">, amount)}
            >
              {auctionData.tournament?.settings.bidMode === 'confirm' && (
                <IncomingRaisesTray auctionRoomId={auctionRoomId} />
              )}
            </AdminTeamsPanel>
          )}

          {/* Center Stage */}
          <div className={isConsole ? 'order-1 col-span-12 lg:col-span-6 lg:order-2' : 'w-full'}>

            {/* Auction progress counter — visible to admins and viewers */}
            {showProgress && (
              <div className={`flex justify-center ${isConsole ? 'mb-3 sm:mb-4' : 'mb-2 sm:mb-3'}`}>
                <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border backdrop-blur-sm shadow-lg ${isUnsoldRound
                  ? 'bg-red-500/15 border-red-500/40 text-red-300'
                  : 'bg-blue-500/15 border-blue-500/40 text-blue-200'}`}>
                  <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider opacity-80">
                    {roundLabel}
                  </span>
                  <span className="text-sm sm:text-base font-extrabold tabular-nums">
                    {progressCurrent}<span className="opacity-50">/</span>{progressTotal}
                  </span>
                </div>
              </div>
            )}

            {/* Player Card */}
            <AnimatePresence mode="wait">
              {currentPlayer ? (
                <motion.div
                  key={currentPlayer._id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className={`bg-linear-to-br from-slate-800 to-slate-900 rounded-xl sm:rounded-2xl border border-slate-700 shadow-2xl ${isConsole ? 'p-4 sm:p-6 lg:p-8' : 'p-3 sm:p-4'}`}
                >
                  {/* Viewer Mode: full-width hero — focus on the player */}
                  {!isConsole ? (
                    <div className="flex flex-col lg:flex-row gap-6 lg:gap-12 items-center lg:items-stretch">
                      {/* Hero Player Photo */}
                      <div className="relative w-full max-w-xs sm:max-w-md lg:max-w-none lg:w-[42%] xl:w-[45%] mx-auto lg:mx-0 shrink-0">
                        {currentPlayer.playerNumber && (
                          <span className="absolute -top-3 -left-3 z-10 inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-blue-600 text-white text-xl sm:text-2xl font-extrabold shadow-lg ring-4 ring-slate-900">
                            #{currentPlayer.playerNumber}
                          </span>
                        )}
                        <PlayerAvatar
                          name={currentPlayer.name}
                          photoUrl={currentPlayer.photoUrl}
                          size="3xl"
                          priority
                          className="rounded-2xl lg:rounded-3xl w-full! h-auto! aspect-square shadow-2xl ring-2 ring-slate-600/50"
                        />
                      </div>

                      {/* Player Details + Bid — fills the remaining width */}
                      <div className="flex-1 w-full flex flex-col justify-center min-w-0">
                        <h2 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-extrabold text-center lg:text-left mb-3 sm:mb-4 leading-none break-words">
                          {currentPlayer.name}
                        </h2>

                        <div className="flex flex-wrap justify-center lg:justify-start gap-2 sm:gap-3 mb-5 sm:mb-6 lg:mb-8">
                          <CategoryChip categoryId={currentPlayer.categoryId} categories={auctionData.tournament?.settings.categories} size="lg" />
                          {roleDisplay ? (
                            <span className="px-4 py-2 lg:px-5 lg:py-2.5 bg-purple-600 rounded-full text-sm sm:text-base lg:text-lg font-semibold">
                              {roleDisplay}
                            </span>
                          ) : null}
                          {currentPlayer.age ? (
                            <span className="px-4 py-2 lg:px-5 lg:py-2.5 bg-slate-700 rounded-full text-sm sm:text-base lg:text-lg">
                              {currentPlayer.age} years
                            </span>
                          ) : null}
                          {currentPlayer.battingBowlingHand ? (
                            <span className="px-4 py-2 lg:px-5 lg:py-2.5 bg-slate-700 rounded-full text-sm sm:text-base lg:text-lg">
                              {currentPlayer.battingBowlingHand}
                            </span>
                          ) : null}
                        </div>

                        {/* Current Bid — the focal number, with the advisory timer beside it */}
                        <div className="flex items-center gap-3 sm:gap-4">
                        <motion.div
                          className="relative flex-1 min-w-0 bg-linear-to-r from-yellow-600 to-orange-600 rounded-2xl lg:rounded-3xl p-5 sm:p-6 lg:p-8 text-center shadow-xl shadow-orange-900/30"
                          animate={{ scale: [1, 1.015, 1] }}
                          transition={{ repeat: Infinity, duration: 2 }}
                        >
                          <div className="text-xs sm:text-sm lg:text-base font-semibold mb-1 lg:mb-2 opacity-90 tracking-widest">
                            {isFirstBid ? "STARTING PRICE" : "CURRENT BID"}
                          </div>
                          <motion.div
                            className="text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-extrabold leading-none"
                            key={currentBid}
                            initial={{ scale: 1.2 }}
                            animate={{ scale: 1 }}
                          >
                            {formatCurrency(currentBid)}
                          </motion.div>
                          {currentBidTeam && !isFirstBid && (
                            <div className="mt-2 lg:mt-3 text-sm sm:text-base lg:text-lg font-medium opacity-95">
                              by <span className="font-bold">{currentBidTeam.name}</span>
                            </div>
                          )}
                        </motion.div>
                        <BidTimerRing countdown={countdown} size="lg" />
                        </div>

                        {/* Base / Next / Bids */}
                        <div className="mt-4 lg:mt-5 grid grid-cols-3 gap-2 sm:gap-3">
                          <div className="bg-slate-800/60 rounded-xl p-3 lg:p-4 border border-slate-700 text-center">
                            <div className="text-[10px] sm:text-xs lg:text-sm text-slate-400 mb-0.5 lg:mb-1">Base</div>
                            <div className="text-sm sm:text-base lg:text-xl font-semibold">
                              {formatCurrency(currentPlayer.basePrice ?? auctionData?.tournament?.settings?.basePrice ?? 100000)}
                            </div>
                          </div>
                          <div className="bg-slate-800/60 rounded-xl p-3 lg:p-4 border border-slate-700 text-center">
                            <div className="text-[10px] sm:text-xs lg:text-sm text-slate-400 mb-0.5 lg:mb-1">Next Bid</div>
                            <div className="text-sm sm:text-base lg:text-xl font-semibold text-green-400">
                              {formatCurrency(isFirstBid ? (currentPlayer.basePrice ?? auctionData?.tournament?.settings?.basePrice ?? 100000) : minNextBid)}
                            </div>
                          </div>
                          <div className="bg-slate-800/60 rounded-xl p-3 lg:p-4 border border-slate-700 text-center">
                            <div className="text-[10px] sm:text-xs lg:text-sm text-slate-400 mb-0.5 lg:mb-1">Bids</div>
                            <div className="text-sm sm:text-base lg:text-xl font-semibold">{auctionData?.totalBidsCount || 0}</div>
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
                      priority
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
                        <CategoryChip categoryId={currentPlayer.categoryId} categories={auctionData.tournament?.settings.categories} size="md" />
                        {roleDisplay ? (
                          <span className="px-3 sm:px-4 py-1.5 sm:py-2 bg-purple-600 rounded-full text-xs sm:text-sm font-semibold">
                            {roleDisplay}
                          </span>
                        ) : null}
                        {currentPlayer.age ? (
                          <span className="px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-700 rounded-full text-xs sm:text-sm">
                            {currentPlayer.age} years
                          </span>
                        ) : null}
                        {currentPlayer.battingBowlingHand ? (
                          <span className="px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-700 rounded-full text-xs sm:text-sm">
                            {currentPlayer.battingBowlingHand}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Current Bid Display, with the advisory timer beside it */}
                  <div className="flex items-center gap-3 sm:gap-4">
                  <motion.div
                    className="flex-1 min-w-0 bg-linear-to-r from-yellow-600 to-orange-600 rounded-xl p-4 sm:p-5 lg:p-6 text-center"
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
                  <BidTimerRing countdown={countdown} size="md" />
                  </div>

                  <GoingOnceHelper
                    visible={countdown.expired && auctionRoom.status === 'live' && !showResult}
                    hasBids={!isFirstBid}
                    resetKey={`${currentPlayer._id}:${auctionData.totalBidsCount}:${auctionRoom.bidTimerEndsAt ?? ''}`}
                    onFinalize={handleFinalize}
                  />
                    </>
                  )}
                </motion.div>
              ) : (
                <div className="text-center py-12 sm:py-16 lg:py-20 text-slate-400">
                  <Trophy className="w-14 h-14 sm:w-16 sm:h-16 lg:w-20 lg:h-20 mx-auto mb-3 sm:mb-4 opacity-50" />
                  {isConsole ? (
                    <p className="text-base sm:text-lg lg:text-xl mb-4">
                      {auctionRoom.status === 'waiting'
                        ? 'Click "Start" to begin the auction'
                        : 'Loading next player...'}
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

          {/* Live Feed - Side panel for admin */}
          {isConsole ? (
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
          avatarSize={isConsole ? 'xl' : '2xl'}
          interactive={isConsole}
          onClose={() => {
            // Closing the result clears the popup; the auto-loader effect then
            // advances to the next player (admins only).
            setShowResult(false);
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

      {/* "Now: <category> set" (presentationOrder by_category) */}
      <SetBanner
        category={categoryFor(setBannerId ?? undefined, auctionData.tournament?.settings.categories) ?? null}
        onDismiss={() => setSetBannerId(null)}
      />

      {/* Unsold Round Transition Flash — big, flashy announcement */}
      <AnimatePresence>
        {showUnsoldRoundBanner && (
          <motion.div
            className="fixed inset-0 z-70 flex items-center justify-center bg-slate-950/80 backdrop-blur-md px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowUnsoldRoundBanner(false)}
          >
            <motion.div
              className="relative text-center"
              initial={{ scale: 0.6, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            >
              <motion.div
                className="absolute -inset-8 rounded-[2.5rem] bg-red-500/25 blur-3xl"
                animate={{ opacity: [0.4, 0.9, 0.4] }}
                transition={{ repeat: Infinity, duration: 1.4 }}
              />
              <div className="relative rounded-3xl border border-red-500/50 bg-linear-to-br from-red-600/30 to-orange-600/20 px-8 py-8 sm:px-16 sm:py-12 shadow-2xl">
                <motion.p
                  className="text-xs sm:text-sm font-bold uppercase tracking-[0.3em] text-red-300 mb-3"
                  animate={{ opacity: [0.6, 1, 0.6] }}
                  transition={{ repeat: Infinity, duration: 1.2 }}
                >
                  All players auctioned
                </motion.p>
                <motion.h2
                  className="text-4xl sm:text-6xl lg:text-7xl font-extrabold text-white drop-shadow-[0_2px_20px_rgba(239,68,68,0.6)]"
                  animate={{ scale: [1, 1.04, 1] }}
                  transition={{ repeat: Infinity, duration: 1.1 }}
                >
                  UNSOLD PLAYERS
                  <br />
                  AUCTION
                </motion.h2>
                {(auctionRoom.unsoldRoundTotal ?? 0) > 0 && (
                  <p className="mt-4 text-base sm:text-xl font-semibold text-orange-200">
                    {auctionRoom.unsoldRoundTotal} player{auctionRoom.unsoldRoundTotal === 1 ? '' : 's'} up for re-auction
                  </p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Viewer: fixed bottom action bar + history/teams sheets */}
      {!isConsole && (
        <>
          <ViewerActionBar
            soldCount={soldPlayers?.length ?? 0}
            unsoldCount={auctionData?.stats?.unsold ?? 0}
            teamsCount={teams?.length ?? 0}
            active={activeSheet}
            onOpen={(sheet) => setActiveSheet((cur) => (cur === sheet ? null : sheet))}
            above={
              paddle ? (
                <OwnerPaddle
                  auctionRoomId={auctionRoomId}
                  paddle={paddle}
                  biddingOpen={auctionRoom.status === 'live' && !!currentPlayer}
                  insights={rosterData ? ownerInsights(rosterData, paddle.team._id) : null}
                />
              ) : undefined
            }
          />
          <ViewerSheets
            active={activeSheet}
            onClose={() => setActiveSheet(null)}
            history={
              activeSheet === 'sold' || activeSheet === 'unsold'
                ? auctionHistory
                : undefined
            }
            teams={teams ?? []}
            soldPlayers={soldPlayers}
            maxPlayersPerTeam={auctionData.tournament?.settings.maxPlayersPerTeam || 15}
            currentBidTeamId={currentBidTeam?._id}
          />
        </>
      )}

      {/* Stalled unsold round — admin decision (infinite-loop guard) */}
      {isConsole && isRoundStalled && auctionRoom.status === 'live' && (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-slate-950/85 backdrop-blur-md px-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-slate-900 p-5 sm:p-6 shadow-2xl">
            <div className="flex items-start gap-3 mb-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Unsold round made no progress</h3>
                <p className="text-sm text-slate-400">
                  {roundLabel} ended with no player sold or marked Final Unsold.
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-300 mb-5">
              Running another identical round would repeat forever. Choose how to proceed:
            </p>
            <div className="space-y-2.5">
              <Button
                onClick={() => handleResolveStall('continue')}
                disabled={resolvingStall}
                className="w-full h-11 bg-blue-600 hover:bg-blue-700"
              >
                <RotateCw className="w-4 h-4 mr-2" />
                Run another unsold round
              </Button>
              <Button
                onClick={() => handleResolveStall('finalizeUnsold')}
                disabled={resolvingStall}
                variant="outline"
                className="w-full h-11 border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <UserX className="w-4 h-4 mr-2" />
                Mark remaining Final Unsold &amp; end
              </Button>
              <Button
                onClick={() => handleResolveStall('end')}
                disabled={resolvingStall}
                variant="outline"
                className="w-full h-11 border-slate-600 hover:bg-slate-800"
              >
                End auction (leave players unsold)
              </Button>
            </div>
          </div>
        </div>
      )}

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