"use client";

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { bidTimerSeconds } from '@/convex/bidRules';
import { useBidCountdown } from '@/hooks/useBidCountdown';
import { playerAvatarSrc } from '@/components/ui/player-avatar';
import type { OverlayParams } from '@/lib/overlayParams';
import { OverlayStage, STAGE_HEIGHT, STAGE_WIDTH } from './OverlayStage';
import { useConnectionView } from '@/lib/useConnectionView';
import { useWakeLock } from '@/lib/wakeLock';

const PlayerResultPopup = dynamic(() => import('@/components/auction/PlayerResultPopup').then(m => ({ default: m.PlayerResultPopup })), { ssr: false });

/** SOLD / UNSOLD stinger length before returning to the layout. */
const STINGER_MS = 4000;
/** Longest we hold a new player back waiting for their photo. */
const PRELOAD_TIMEOUT_MS = 1500;
const TICKER_SIZE = 3;

interface BroadcastOverlayProps extends OverlayParams {
  roomId: string;
}

/**
 * Stream overlay for an OBS / vMix Browser Source (1920x1080, transparent).
 * Public and session-free: it reads exactly the viewer's three shared queries
 * and never touches Clerk, so the venue PC needs no sign-in.
 */
export function BroadcastOverlay({ roomId, mode, theme, safe }: BroadcastOverlayProps) {
  const auctionRoomId = roomId as Id<"auctionRooms">;

  // Same hot/cold split and args as the viewer page — no new queries.
  const liveData = useQuery(api.auctions.getLiveAuction, { auctionRoomId });
  const rosterData = useQuery(
    api.auctions.getAuctionRoster,
    liveData
      ? {
          tournamentId: liveData.auctionRoom.tournamentId,
          currentPlayerId: liveData.auctionRoom.currentPlayerId,
        }
      : 'skip',
  );
  const latestSaleEvent = useQuery(api.auctions.getLatestSaleEvent, { auctionRoomId });

  useTransparentPage();
  useWakeLock(true);
  const scale = useStageScale();
  // On a stream a frozen price is worse than nothing: hide the card while
  // the socket has been down for a few seconds; it returns resynced.
  const connection = useConnectionView();
  const stale = connection.kind === 'reconnecting' && connection.secondsStale >= 3;
  const stinger = useSaleStinger(latestSaleEvent);

  const settings = rosterData?.tournament?.settings;
  const countdown = useBidCountdown({
    endsAt: liveData?.auctionRoom.bidTimerEndsAt,
    serverTime: liveData?.serverTime,
    status: liveData?.auctionRoom.status,
    pausedTimeRemaining: liveData?.auctionRoom.pausedTimeRemaining,
    timerSeconds: settings ? bidTimerSeconds(settings) : undefined,
    hasCurrentPlayer: Boolean(rosterData?.currentPlayer),
  });

  const player = useReadyPlayer(rosterData?.currentPlayer ?? null, mode === 'full' ? '3xl' : '2xl');

  const teams = rosterData?.teams ?? [];
  const teamById = new Map(teams.map((team) => [team._id as string, team]));
  const basePrice = player?.basePrice ?? settings?.basePrice ?? 100000;
  const recentBids = liveData?.recentBids ?? [];
  const leading = liveData?.currentBidTeam;

  return (
    <div data-broadcast-overlay className="fixed inset-0 overflow-hidden bg-transparent">
      <div style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {liveData && rosterData && !stinger && !stale && (
          <OverlayStage
            mode={mode}
            theme={theme}
            safe={safe}
            tournament={
              rosterData.tournament
                ? { name: rosterData.tournament.name, logoUrl: rosterData.tournament.logoUrl, footerText: settings?.footerText }
                : null
            }
            status={liveData.auctionRoom.status}
            player={player}
            basePrice={basePrice}
            currentBid={liveData.currentBidAmount ?? basePrice}
            isFirstBid={recentBids.length === 0}
            leadingTeam={leading ? { name: leading.name, logoUrl: leading.logoUrl, colorPrimary: leading.colorPrimary } : null}
            ticker={recentBids.slice(0, TICKER_SIZE).map((bid) => {
              const team = teamById.get(bid.teamId);
              return { id: bid._id, teamName: team?.name ?? 'Team', teamColor: team?.colorPrimary ?? '#64748b', amount: bid.amount };
            })}
            teams={teams.map((team) => ({
              _id: team._id,
              name: team.name,
              logoUrl: team.logoUrl,
              colorPrimary: team.colorPrimary,
              purseRemaining: team.purseRemaining,
              playerCount: team.playerCount,
            }))}
            countdown={countdown}
          />
        )}
      </div>

      {stinger && (
        <PlayerResultPopup
          show
          playerName={stinger.playerName}
          playerPhotoUrl={stinger.playerPhotoUrl}
          teamName={stinger.teamName}
          teamLogoUrl={stinger.teamLogoUrl}
          tournamentLogoUrl={rosterData?.tournament?.logoUrl}
          amount={stinger.amount}
          sold={stinger.sold}
          teamColor={stinger.teamColor}
          onClose={() => {}}
          interactive={false}
          avatarSize="2xl"
          showConfetti={false}
        />
      )}
    </div>
  );
}

/** OBS composites the page over video, so html and body must be see-through. */
function useTransparentPage() {
  useEffect(() => {
    const targets = [document.documentElement, document.body];
    const previous = targets.map((el) => el.style.background);
    targets.forEach((el) => { el.style.background = 'transparent'; });
    return () => targets.forEach((el, i) => { el.style.background = previous[i]; });
  }, []);
}

/** Fit the fixed 1920x1080 stage to the window (1 in a 1920x1080 Browser Source). */
function useStageScale(): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return scale;
}

type SaleEvent = NonNullable<ReturnType<typeof useQuery<typeof api.auctions.getLatestSaleEvent>>>;

/**
 * The SOLD/UNSOLD stinger for STINGER_MS after each new sale event. Like the
 * viewer, the event already current on first load is recorded, not replayed.
 */
function useSaleStinger(event: SaleEvent | null | undefined): SaleEvent | null {
  const lastIdRef = useRef<string | null | undefined>(undefined);
  const [stinger, setStinger] = useState<SaleEvent | null>(null);

  useEffect(() => {
    if (event === undefined) return;
    const id = event?.eventId ?? null;
    if (lastIdRef.current === undefined) {
      lastIdRef.current = id;
      return;
    }
    if (!event || id === lastIdRef.current) return;
    // Deferred (as on the viewer page); the id is only marked shown once the
    // stinger actually starts, so a re-render in between can't swallow it.
    const show = setTimeout(() => {
      lastIdRef.current = id;
      setStinger(event);
    }, 0);
    return () => clearTimeout(show);
  }, [event]);

  useEffect(() => {
    if (!stinger) return;
    const hide = setTimeout(() => setStinger(null), STINGER_MS);
    return () => clearTimeout(hide);
  }, [stinger]);

  return stinger;
}

/**
 * Hold a newly presented player back until their photo is in the browser
 * cache (or PRELOAD_TIMEOUT_MS passes), so the stream never shows a card with
 * a blank photo popping in. The next player is picked at random server-side,
 * so the current one is the earliest image we can know about.
 */
function useReadyPlayer<P extends { _id: string; photoUrl?: string }>(
  player: P | null,
  size: '2xl' | '3xl',
): P | null {
  const [readyId, setReadyId] = useState<string | null>(null);
  const playerId = player?._id ?? null;
  const src = playerAvatarSrc(player?.photoUrl, size);

  useEffect(() => {
    if (!playerId) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setReadyId(playerId);
    };
    if (!src) {
      finish();
      return;
    }
    const img = new Image();
    img.onload = finish;
    img.onerror = finish;
    const fallback = setTimeout(finish, PRELOAD_TIMEOUT_MS);
    img.src = src;
    return () => {
      done = true;
      clearTimeout(fallback);
      img.onload = null;
      img.onerror = null;
    };
  }, [playerId, src]);

  return player && readyId === player._id ? player : null;
}
