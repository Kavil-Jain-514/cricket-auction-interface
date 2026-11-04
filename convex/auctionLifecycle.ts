// convex/auctionLifecycle.ts - Putting a room live. Shared by
// auctions:startAuction and snapshots:startRehearsal, so a rehearsal starts
// exactly like the real auction. Also the one definition of "the auction has
// started", which locks team owners out of editing their team.
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * A room has started once it leaves "waiting" (live, paused or completed).
 * Restarting the auction or ending a rehearsal puts it back to "waiting".
 */
export function roomHasStarted(room: Pick<Doc<"auctionRooms">, "status">): boolean {
  return room.status !== "waiting";
}

/** True once any of the tournament's rooms has started (see roomHasStarted). */
export async function auctionHasStarted(
  ctx: QueryCtx | MutationCtx,
  tournamentId: Id<"tournaments">,
): Promise<boolean> {
  const rooms = await ctx.db
    .query("auctionRooms")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
    .collect();
  return rooms.some(roomHasStarted);
}

/** Room live in the main round, tournament active, auction_started event. */
export async function goLive(ctx: MutationCtx, room: Doc<"auctionRooms">) {
  const now = Date.now();
  await Promise.all([
    ctx.db.patch(room._id, {
      status: "live",
      updatedAt: now,
      // Fresh start: the main round, no unsold-round state yet.
      auctionPhase: "main",
      roundNumber: 1,
      unsoldRoundTotal: undefined,
      unsoldQueue: undefined,
      unsoldCursor: undefined,
      roundStalled: undefined,
    }),
    // Ensure tournament status is 'active' so viewers can access the auction
    ctx.db.patch(room.tournamentId, {
      status: "active",
      updatedAt: now,
    }),
    ctx.db.insert("auctionEvents", {
      auctionRoomId: room._id,
      type: "auction_started",
      data: {},
      timestamp: now,
    }),
  ]);
}
