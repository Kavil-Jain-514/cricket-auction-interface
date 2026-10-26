// convex/bidRules.ts
// The single squad-reserve / max-bid rule, shared by placeBid (enforcement),
// getAuctionRoster (display) and the admin corrections in admin.ts. Pure
// functions only — no ctx, no DB reads — so the rule is unit-testable and the
// displayed max can never drift from the enforced max.

export const DEFAULT_BASE_PRICE = 100000;

/**
 * A team's whole purse: the tournament base purse plus any admin adjustments.
 * The money invariant is purseRemaining + purseSpent == teamPurseTotal.
 */
export function teamPurseTotal(
  basePurse: number,
  team: { purseAdjustment?: number },
): number {
  return basePurse + (team.purseAdjustment ?? 0);
}

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
 * rest of its squad. 0 when the squad is full.
 *
 * Reserve formula. After this purchase the team has
 *   S = maxPlayersPerTeam - playersOnTeam - 1   future slots.
 * Each squad min rule r still unmet after this purchase needs U_r of them
 * (minRuleSlots in squadRules.ts), reserved at P_r = max(the cheapest pending
 * player r would accept, reservePrice). The other slots use reservePrice:
 *   reserve = sum(U_r * P_r) + max(0, S - sum(U_r)) * reservePrice
 * With no min rules this is S * reservePrice, exactly as before. Overlapping
 * rules (a Marquee wicket keeper fills both) are counted separately, so the
 * reserve errs high, never low. If sum(U_r) > S the minimums can no longer
 * fit in the squad and the team can't bid at all (0).
 */
export function maxAllowedBid({
  purseRemaining,
  playersOnTeam,
  maxPlayersPerTeam,
  reservePrice,
  minRuleSlots = [],
}: {
  purseRemaining: number;
  playersOnTeam: number;
  maxPlayersPerTeam: number;
  reservePrice: number;
  minRuleSlots?: Array<{ unfilled: number; price: number | undefined }>;
}): number {
  if (isSquadFull(playersOnTeam, maxPlayersPerTeam)) return 0;
  const futureSlots = Math.max(0, maxPlayersPerTeam - playersOnTeam - 1);
  const ruleSlots = minRuleSlots.reduce((n, r) => n + r.unfilled, 0);
  if (ruleSlots > futureSlots) return 0;
  const reserve =
    minRuleSlots.reduce(
      (sum, r) => sum + r.unfilled * Math.max(r.price ?? 0, reservePrice),
      0,
    ) +
    (futureSlots - ruleSlots) * reservePrice;
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

// ── Base price and increments ────────────────────────────────────────────────

export interface PlayerCategory {
  id: string;
  name: string;
  basePrice: number;
  order: number;
  colour: string;
}

export interface IncrementSlab {
  fromAmount: number;
  increment: number;
}

/** Category for `categoryId`, or undefined when absent or since deleted. */
export function categoryFor(
  categoryId: string | undefined,
  categories: PlayerCategory[] | undefined,
): PlayerCategory | undefined {
  if (!categoryId) return undefined;
  return categories?.find((c) => c.id === categoryId);
}

/** Starting price: the player's own, else its category's, else the tournament's. */
export function effectiveBasePrice(
  player: { basePrice?: number; categoryId?: string },
  settings: { basePrice?: number; categories?: PlayerCategory[] },
): number {
  return (
    player.basePrice ??
    categoryFor(player.categoryId, settings.categories)?.basePrice ??
    settings.basePrice ??
    DEFAULT_BASE_PRICE
  );
}

/**
 * Increment for a bid standing at `currentBid`: the last slab whose
 * fromAmount <= currentBid (slabs are stored ascending), so a bid exactly on
 * a boundary already uses the higher band. No slabs, or a bid below the first
 * one, uses `minBidIncrement` exactly as before slabs existed.
 */
export function incrementFor(
  currentBid: number,
  slabs: IncrementSlab[] | undefined,
  minBidIncrement: number,
): number {
  let increment = minBidIncrement;
  for (const slab of slabs ?? []) {
    if (slab.fromAmount > currentBid) break;
    increment = slab.increment;
  }
  return increment;
}

/** Lowest raise over a standing bid of `currentBid`. */
export function nextMinimumBid(
  currentBid: number,
  slabs: IncrementSlab[] | undefined,
  minBidIncrement: number,
): number {
  return currentBid + incrementFor(currentBid, slabs, minBidIncrement);
}
