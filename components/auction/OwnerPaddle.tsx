"use client";

import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gavel, Crown, Hourglass } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { formatCurrency, getErrorMessage } from '@/lib/utils';
import { TeamLogo } from '@/components/ui/team-logo';
import { nextMinimumBid, type IncrementSlab } from '@/convex/bidRules';

/** Shape returned by auctions:getMyPaddle (non-null). */
export interface PaddleState {
  bidMode: 'admin_only' | 'confirm' | 'open';
  team: { _id: string; name: string; logoUrl?: string; colorPrimary: string };
  purseRemaining: number;
  playersNeeded: number;
  maxAllowedBid: number;
  minNextBid: number | null;
  minBidIncrement: number;
  incrementSlabs: IncrementSlab[];
  isLeading: boolean;
  currentPlayerId: string | null;
  myPending: { _id: string; amount: number; createdAt: number } | null;
  lastResolved: { _id: string; status: string; reason?: string; amount: number } | null;
}

interface OwnerPaddleProps {
  auctionRoomId: Id<"auctionRooms">;
  paddle: PaddleState;
  /** Room is live with a player on the block. */
  biddingOpen: boolean;
}

type Flash = { tone: 'good' | 'bad' | 'info'; text: string; key: number };

const STEPS = [1, 2, 4] as const;

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Vibration is best-effort (unsupported on iOS Safari and desktops).
  }
}

/**
 * Team owner's bidding paddle. One big "Raise to ₹X" button; the +1×/+2×/+4×
 * steps raise by that many increments over the current bid. The amount shown
 * is always the amount sent — the server never picks a price for the owner.
 * Every rule is enforced server-side (auctions:raiseBid); the disabled states
 * here only save a round trip.
 */
export function OwnerPaddle({ auctionRoomId, paddle, biddingOpen }: OwnerPaddleProps) {
  const raiseBid = useMutation(api.auctions.raiseBid);
  const [step, setStep] = useState<(typeof STEPS)[number]>(1);
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);

  const showFlash = (tone: Flash['tone'], text: string) => {
    setFlash({ tone, text, key: Date.now() });
    buzz(tone === 'bad' ? [80, 40, 80] : 60);
  };

  // Reset the step for each new player.
  useEffect(() => {
    setStep(1);
  }, [paddle.currentPlayerId]);

  // Auctioneer's decision on a confirm-mode raise. Skip whatever outcome is
  // already there on first render so reopening the page doesn't re-announce it.
  const seenResolved = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const resolved = paddle.lastResolved;
    if (seenResolved.current === undefined) {
      seenResolved.current = resolved?._id ?? null;
      return;
    }
    if (!resolved || resolved._id === seenResolved.current) return;
    seenResolved.current = resolved._id;
    if (resolved.status === 'accepted') {
      showFlash('good', `Accepted at ${formatCurrency(resolved.amount)}`);
    } else if (resolved.status === 'rejected') {
      showFlash('bad', resolved.reason || 'Raise declined');
    }
  }, [paddle.lastResolved]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  // Step N is N-1 further raises above the minimum, each using its own
  // price band's increment (slabs), as placeBid would.
  let amount = paddle.minNextBid;
  for (let i = 1; amount !== null && i < step; i++) {
    amount = nextMinimumBid(amount, paddle.incrementSlabs, paddle.minBidIncrement);
  }
  const overMax = amount !== null && amount > paddle.maxAllowedBid;
  const squadFull = paddle.playersNeeded === 0;

  let blockedLabel: string | null = null;
  if (paddle.bidMode === 'admin_only') blockedLabel = 'Bids are called by the auctioneer';
  else if (squadFull) blockedLabel = 'Your squad is complete';
  else if (!biddingOpen || amount === null) blockedLabel = 'Waiting for the next player';
  else if (paddle.isLeading) blockedLabel = "You're leading";
  else if (overMax) blockedLabel = `Over your max bid (${formatCurrency(paddle.maxAllowedBid)})`;

  const handleRaise = async () => {
    if (blockedLabel || amount === null || sending) return;
    setSending(true);
    try {
      const res = await raiseBid({ auctionRoomId, amount });
      if (!res.success) {
        showFlash('bad', res.reason);
      } else if ('pending' in res && res.pending) {
        showFlash('info', `Sent ${formatCurrency(res.amount)} to the auctioneer`);
      } else {
        showFlash('good', `Bid placed at ${formatCurrency(res.amount)}`);
      }
    } catch (error) {
      showFlash('bad', getErrorMessage(error, 'Raise failed'));
    } finally {
      setSending(false);
    }
  };

  const maxPct =
    paddle.purseRemaining > 0
      ? Math.min(100, (paddle.maxAllowedBid / paddle.purseRemaining) * 100)
      : 0;
  const flashClass =
    flash?.tone === 'good'
      ? 'bg-green-500/20 border-green-400 text-green-200'
      : flash?.tone === 'bad'
        ? 'bg-red-500/20 border-red-400 text-red-200'
        : 'bg-blue-500/20 border-blue-400 text-blue-200';

  return (
    <div
      className="relative rounded-2xl bg-slate-900/90 backdrop-blur-lg border-2 p-3 shadow-2xl"
      style={{ borderColor: paddle.isLeading ? '#22c55e' : paddle.team.colorPrimary }}
    >
      {/* Team + purse */}
      <div className="flex items-center gap-2.5 mb-2">
        <TeamLogo name={paddle.team.name} logoUrl={paddle.team.logoUrl} primaryColor={paddle.team.colorPrimary} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-bold truncate">{paddle.team.name}</span>
            <span className="text-xs text-slate-400 shrink-0">
              Purse <span className="font-semibold text-green-400">{formatCurrency(paddle.purseRemaining)}</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-slate-700 overflow-hidden" aria-hidden>
            <div className="h-full rounded-full bg-amber-400" style={{ width: `${maxPct}%` }} />
          </div>
          <div className="mt-0.5 flex justify-between text-[11px] text-slate-400">
            <span>Max bid <span className="text-amber-300 font-semibold">{formatCurrency(paddle.maxAllowedBid)}</span></span>
            <span>{paddle.playersNeeded} more to buy</span>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="grid grid-cols-3 gap-2 mb-2" role="radiogroup" aria-label="Raise by">
        {STEPS.map((k) => (
          <button
            key={k}
            role="radio"
            aria-checked={step === k}
            onClick={() => setStep(k)}
            className={`h-9 rounded-lg border text-sm font-semibold transition touch-target ${
              step === k
                ? 'bg-slate-100 text-slate-900 border-white'
                : 'bg-slate-800 text-slate-300 border-slate-600'
            }`}
          >
            +{k}×
          </button>
        ))}
      </div>

      {/* Paddle */}
      <button
        onClick={handleRaise}
        disabled={!!blockedLabel || sending}
        className={`w-full h-16 rounded-xl text-lg font-extrabold flex items-center justify-center gap-2 transition active:scale-[0.98] touch-target ${
          paddle.isLeading
            ? 'bg-green-600/90 text-white'
            : blockedLabel
              ? 'bg-slate-700 text-slate-400'
              : 'text-white shadow-lg'
        }`}
        style={!paddle.isLeading && !blockedLabel ? { backgroundColor: paddle.team.colorPrimary } : undefined}
      >
        {paddle.isLeading ? <Crown className="w-5 h-5" /> : <Gavel className="w-5 h-5" />}
        {sending ? 'Sending…' : blockedLabel ?? `Raise to ${formatCurrency(amount!)}`}
      </button>

      {paddle.myPending && (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-blue-300">
          <Hourglass className="w-3.5 h-3.5" />
          Waiting for the auctioneer · {formatCurrency(paddle.myPending.amount)}
        </p>
      )}

      <AnimatePresence>
        {flash && (
          <motion.div
            key={flash.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="status"
            className={`absolute inset-x-3 -top-12 rounded-xl border px-3 py-2 text-center text-sm font-semibold ${flashClass}`}
          >
            {flash.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
