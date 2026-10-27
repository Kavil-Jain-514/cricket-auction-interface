// lib/optimisticBid.ts - The console's optimistic bid (Convex optimistic
// update on getLiveAuction). Shown the moment the auctioneer taps; Convex
// drops it when placeBid returns and the real query result replaces it, so a
// rejected bid ({ success: false }) rolls back by itself.

export interface LivePayload {
  currentBidAmount?: number;
  currentBidTeamId?: string;
  currentBidTeam: unknown;
  recentBids: Array<{ _id: string; teamId: string; amount: number; timestamp: number }>;
  totalBidsCount: number;
}

/** The live payload as if `bid` had already been accepted. */
export function applyOptimisticBid<P extends LivePayload>(
  live: P,
  bid: { teamId: string; amount: number },
  team: P["currentBidTeam"] | null,
  now: number,
): P {
  return {
    ...live,
    currentBidAmount: bid.amount,
    currentBidTeamId: bid.teamId,
    currentBidTeam: team ?? live.currentBidTeam,
    recentBids: [{ _id: `optimistic:${now}`, teamId: bid.teamId, amount: bid.amount, timestamp: now }, ...live.recentBids].slice(0, 10),
    totalBidsCount: live.totalBidsCount + 1,
  };
}

/** A fresh id for one console action (retries of that action reuse it). */
export function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
