"use client";

import { useReducedMotion } from 'framer-motion';
import { Pause } from 'lucide-react';
import type { BidCountdown } from '@/hooks/useBidCountdown';

const SIZES = {
  md: { box: 64, stroke: 6, text: 'text-xl' },
  lg: { box: 96, stroke: 8, text: 'text-3xl' },
} as const;

const TONE_STROKE = {
  normal: 'stroke-emerald-400',
  amber: 'stroke-amber-400',
  red: 'stroke-red-500',
} as const;

const TONE_TEXT = {
  normal: 'text-white',
  amber: 'text-amber-300',
  red: 'text-red-400',
} as const;

interface BidTimerRingProps {
  countdown: BidCountdown;
  size?: keyof typeof SIZES;
  className?: string;
}

/**
 * Advisory bid countdown ring. Purely visual: the auctioneer still sells
 * manually. Hidden when the timer is off or no player is up.
 */
export function BidTimerRing({ countdown, size = 'md', className = '' }: BidTimerRingProps) {
  const reduceMotion = useReducedMotion();
  if (!countdown.enabled) return null;

  const { box, stroke, text } = SIZES[size];
  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const tone = countdown.paused ? 'normal' : countdown.tone;
  const pulse = !reduceMotion && !countdown.paused && tone === 'red' && !countdown.expired;

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${pulse ? 'animate-pulse' : ''} ${className}`}
      style={{ width: box, height: box }}
      role="timer"
      aria-label={countdown.paused ? `Bid timer paused at ${countdown.secondsLeft} seconds` : `${countdown.secondsLeft} seconds left`}
    >
      <svg width={box} height={box} className="-rotate-90" aria-hidden="true">
        <circle cx={box / 2} cy={box / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-slate-700/80" />
        <circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - countdown.fraction)}
          className={`${countdown.paused ? 'stroke-slate-400' : TONE_STROKE[tone]} ${reduceMotion ? '' : 'transition-[stroke-dashoffset] duration-300 ease-linear'}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={`${text} font-extrabold tabular-nums ${countdown.paused ? 'text-slate-300' : TONE_TEXT[tone]}`}>
          {countdown.secondsLeft}
        </span>
        {countdown.paused && <Pause className="w-3 h-3 mt-0.5 text-slate-400" aria-hidden="true" />}
      </div>
    </div>
  );
}
