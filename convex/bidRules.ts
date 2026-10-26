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
