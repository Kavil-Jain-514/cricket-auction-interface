// convex/auctionCounts.ts
// Denormalized per-tournament auction counts, maintained on the WRITE side.
//
// WHY THIS EXISTS
// ---------------
// getAuctionRoster fans out to every viewer (150+) each time a player is sold.
// Computing the pending/unsold counts and the minimum pending base price there
// means scanning the entire players table on every fan-out — the bottleneck the
// load test surfaced (getAuctionRoster collapsing under concurrency).
//
// Instead we store those values on the tournament document and refresh them from
// HERE, inside mutations. Mutations are admin-triggered, serialized per auction,
// and never fan out to viewers, so the O(players) scan is paid on the cheap
// (write) side. The hot read path then only needs O(sold) work.
//
// SELF-HEALING BY DESIGN
// ----------------------
// This is a full recompute, not an incremental +1/-1. Calling it after any
// player mutation yields correct counts regardless of what changed, and a missed
// call self-corrects on the next sale (finalizePlayerSale / startNextPlayer both
// call it, and they run constantly during an auction). That trades a few extra
// doc reads in mutations for ZERO risk of counter drift in the money-adjacent
// bid-limit logic (maxAllowedBid depends on minPendingBasePrice).

import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export type AuctionCounts = NonNullable<Doc<"tournaments">["auctionCounts"]>;

/**
 * Pure count of players per auction status for one tournament. Shared by the
 * write-side sync below and the admin reconciliation query, so both always
 * agree on what "correct" counts are.
 */
export function computeAuctionCounts(
  players: Doc<"players">[],
  teams: Doc<"teams">[],
  defaultBasePrice: number,
): AuctionCounts {
  // Team captains are pre-assigned and never auctioned, so they must not appear
  // in ANY count (pending/sold/unsold/inAuction) or affect minPendingBasePrice.
  const captainPlayerIds = new Set(
    teams.flatMap((t) => (t.captainPlayerId ? [t.captainPlayerId] : [])),
  );

  let pending = 0;
  let sold = 0;
  let unsold = 0;
  let inAuction = 0;
  let minPendingBasePrice: number | undefined = undefined;

  for (const p of players) {
    if (captainPlayerIds.has(p._id)) continue; // captains are outside the auction
    switch (p.auctionStatus) {
      case "pending": {
        pending++;
        const bp = p.basePrice ?? defaultBasePrice;
        if (minPendingBasePrice === undefined || bp < minPendingBasePrice) {
          minPendingBasePrice = bp;
        }
        break;
      }
      case "sold":
        sold++;
        break;
      case "unsold":
        unsold++;
        break;
      case "in_auction":
        inAuction++;
        break;
    }
  }

  return { pending, sold, unsold, inAuction, minPendingBasePrice };
}

export function auctionCountsEqual(
  a: AuctionCounts | undefined,
  b: AuctionCounts,
): boolean {
  return (
    !!a &&
    a.pending === b.pending &&
    a.sold === b.sold &&
    a.unsold === b.unsold &&
    a.inAuction === b.inAuction &&
    a.minPendingBasePrice === b.minPendingBasePrice
  );
}

/**
 * Recompute and persist `tournament.auctionCounts` for one tournament.
 *
 * Only writes when a value actually changed, so redundant/defensive calls do not
 * needlessly invalidate the getAuctionRoster subscription (which reads the
 * tournament doc). Does NOT bump `updatedAt` — the counts are derived data, not
 * a user edit.
 */
export async function syncTournamentAuctionCounts(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
): Promise<void> {
  const tournament = await ctx.db.get(tournamentId);
  if (!tournament) return; // tournament was deleted — nothing to sync

  const [players, teams] = await Promise.all([
    ctx.db
      .query("players")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
      .collect(),
    ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
      .collect(),
  ]);

  const counts = computeAuctionCounts(
    players,
    teams,
    tournament.settings.basePrice ?? 100000,
  );

  if (auctionCountsEqual(tournament.auctionCounts, counts)) {
    return; // unchanged — skip the write to avoid a needless query invalidation
  }

  await ctx.db.patch(tournamentId, { auctionCounts: counts });
}

/**
 * One-time backfill: populate `auctionCounts` for every existing tournament.
 * Run once after deploying the schema change:
 *   npx convex run auctionCounts:backfillAuctionCounts
 * Safe to re-run (idempotent — it just recomputes).
 */
export const backfillAuctionCounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tournaments = await ctx.db.query("tournaments").collect();
    for (const t of tournaments) {
      await syncTournamentAuctionCounts(ctx, t._id);
    }
    return { tournamentsProcessed: tournaments.length };
  },
});
