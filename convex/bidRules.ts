// convex/bidRules.ts
// The single squad-reserve / max-bid rule, shared by placeBid (enforcement),
// getAuctionRoster (display) and the admin corrections in admin.ts. Pure
// functions only — no ctx, no DB reads — so the rule is unit-testable and the
// displayed max can never drift from the enforced max.

export const DEFAULT_BASE_PRICE = 100000;

/**
 * Price used to reserve purse for each future squad slot: the cheapest base
 * price still in the pending pool, else the current player's base price, else
 * the tournament default.
 */
export function reserveBasePrice({
  minPendingBasePrice,
  currentPlayerBasePrice,
  tournamentBasePrice,
}: {
  minPendingBasePrice: number | undefined;
  currentPlayerBasePrice: number | undefined;
  tournamentBasePrice: number | undefined;
}): number {
  return (
    minPendingBasePrice ??
    currentPlayerBasePrice ??
    tournamentBasePrice ??
    DEFAULT_BASE_PRICE
  );
}

export function isSquadFull(
  playersOnTeam: number,
  maxPlayersPerTeam: number,
): boolean {
  return playersOnTeam >= maxPlayersPerTeam;
}

/**
 * Most a team may pay for its next player while still being able to fill the
 * rest of its squad at `reservePrice` per slot. 0 when the squad is full.
 */
export function maxAllowedBid({
  purseRemaining,
  playersOnTeam,
  maxPlayersPerTeam,
  reservePrice,
}: {
  purseRemaining: number;
  playersOnTeam: number;
  maxPlayersPerTeam: number;
  reservePrice: number;
}): number {
  if (isSquadFull(playersOnTeam, maxPlayersPerTeam)) return 0;
  const playersNeeded = maxPlayersPerTeam - playersOnTeam;
  const reserve = Math.max(0, playersNeeded - 1) * reservePrice;
  return Math.max(0, purseRemaining - reserve);
}

// ── Bid timer ────────────────────────────────────────────────────────────────
// The timer is advisory: a UI countdown that never auto-finalises and never
// rejects a late bid. 0 turns it off (no bidTimerEndsAt writes at all); an
// absent value is the legacy 30s default.

export const DEFAULT_BID_TIMER_SECONDS = 30;
export const MIN_BID_TIMER_SECONDS = 10;
export const MAX_BID_TIMER_SECONDS = 120;

export function bidTimerSeconds(settings: { bidTimerSeconds?: number }): number {
  return settings.bidTimerSeconds ?? DEFAULT_BID_TIMER_SECONDS;
}

/** When the countdown ends if it starts at `now`, or undefined when the timer is off. */
export function bidTimerEndsAt(
  settings: { bidTimerSeconds?: number },
  now: number,
): number | undefined {
  const seconds = bidTimerSeconds(settings);
  return seconds > 0 ? now + seconds * 1000 : undefined;
}

/** null when valid: 0 (off) or a whole number of seconds from 10 to 120. */
export function validateBidTimerSeconds(seconds: number): string | null {
  if (
    Number.isInteger(seconds) &&
    (seconds === 0 ||
      (seconds >= MIN_BID_TIMER_SECONDS && seconds <= MAX_BID_TIMER_SECONDS))
  ) {
    return null;
  }
  return `Bid timer must be off (0) or between ${MIN_BID_TIMER_SECONDS} and ${MAX_BID_TIMER_SECONDS} seconds`;
}
