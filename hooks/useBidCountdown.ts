"use client";

import { useEffect, useRef, useState } from 'react';
import { remainingMs, sampleClockOffset, timerTone, type TimerTone } from '@/lib/bidTimer';

const TICK_MS = 250;

interface BidCountdownInput {
  /** auctionRooms.bidTimerEndsAt (server clock). */
  endsAt: number | undefined;
  /** getLiveAuction's serverTime, for clock-offset correction. */
  serverTime: number | undefined;
  status: string | undefined;
  /** Seconds frozen by pauseAuction. */
  pausedTimeRemaining: number | undefined;
  /** Tournament bidTimerSeconds (0 = off); undefined while the roster loads. */
  timerSeconds: number | undefined;
  hasCurrentPlayer: boolean;
}

export interface BidCountdown {
  enabled: boolean;
  secondsLeft: number;
  /** Share of the full duration left, 0..1, for the ring. */
  fraction: number;
  tone: TimerTone;
  paused: boolean;
  expired: boolean;
}

/**
 * Advisory bid countdown, rendered locally. No server writes or queries per
 * tick: the offset is re-sampled only when a new getLiveAuction result lands.
 */
export function useBidCountdown({
  endsAt,
  serverTime,
  status,
  pausedTimeRemaining,
  timerSeconds,
  hasCurrentPlayer,
}: BidCountdownInput): BidCountdown {
  const offsetRef = useRef<number | undefined>(undefined);
  // The latest tick, tagged with the endsAt it was computed for, so a fresh
  // endsAt (a bid just landed) never renders a stale "0s" for one frame.
  const [tick, setTick] = useState<{ endsAt: number; leftMs: number } | null>(null);

  useEffect(() => {
    if (serverTime === undefined) return;
    offsetRef.current = sampleClockOffset(offsetRef.current, serverTime, Date.now());
  }, [serverTime]);

  const seconds = timerSeconds ?? 0;
  const ticking = status === 'live' && endsAt !== undefined && seconds > 0;
  useEffect(() => {
    if (!ticking || endsAt === undefined) return;
    const update = () =>
      setTick({ endsAt, leftMs: remainingMs(endsAt, offsetRef.current ?? 0, Date.now(), seconds) });
    const first = setTimeout(update, 0);
    const id = setInterval(update, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [ticking, endsAt, seconds]);

  const paused = status === 'paused';
  const enabled =
    seconds > 0 && hasCurrentPlayer && (paused || (status === 'live' && endsAt !== undefined));

  if (!enabled) {
    return { enabled: false, secondsLeft: 0, fraction: 0, tone: 'normal', paused: false, expired: false };
  }

  const leftMs = paused
    ? Math.min((pausedTimeRemaining ?? 0) * 1000, seconds * 1000)
    : tick && tick.endsAt === endsAt
      ? tick.leftMs
      : seconds * 1000;
  const secondsLeft = Math.ceil(leftMs / 1000);

  return {
    enabled: true,
    secondsLeft,
    fraction: leftMs / (seconds * 1000),
    tone: timerTone(secondsLeft),
    paused,
    expired: !paused && leftMs <= 0,
  };
}
