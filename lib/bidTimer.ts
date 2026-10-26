// lib/bidTimer.ts
// Pure maths for the advisory bid countdown. The server writes bidTimerEndsAt
// in its own clock; the client renders it locally with no per-tick queries.

export type TimerTone = 'normal' | 'amber' | 'red';

/**
 * Running estimate of (server clock − client clock).
 *
 * getLiveAuction returns `serverTime`, frozen when the query ran. Convex can
 * hand a late joiner a cached result, so a sample's serverTime may be older
 * than "now" on the server, never newer. Each sample is therefore a lower
 * bound on the true offset, and the running max converges on the first fresh
 * result (the next bid).
 */
export function sampleClockOffset(
  prev: number | undefined,
  serverTime: number,
  clientNow: number,
): number {
  const sample = serverTime - clientNow;
  return prev === undefined ? sample : Math.max(prev, sample);
}

/**
 * Milliseconds left on the countdown, clamped to [0, timerSeconds] so any
 * remaining offset error can never show more than the configured duration.
 */
export function remainingMs(
  endsAt: number,
  offset: number,
  clientNow: number,
  timerSeconds: number,
): number {
  const left = endsAt - (clientNow + offset);
  return Math.min(Math.max(left, 0), timerSeconds * 1000);
}

/** Amber from 10s, red from 5s. */
export function timerTone(secondsLeft: number): TimerTone {
  if (secondsLeft <= 5) return 'red';
  if (secondsLeft <= 10) return 'amber';
  return 'normal';
}

/** Choices for the settings dropdown (0 = off). The server accepts 0 or 10–120. */
export const BID_TIMER_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90, 120];

/** Dropdown choices, keeping a stored value that isn't one of the presets. */
export function bidTimerOptions(current: number): number[] {
  return BID_TIMER_OPTIONS.includes(current)
    ? BID_TIMER_OPTIONS
    : [...BID_TIMER_OPTIONS, current].sort((a, b) => a - b);
}

export function bidTimerLabel(seconds: number): string {
  return seconds === 0 ? 'Off' : `${seconds} seconds`;
}
