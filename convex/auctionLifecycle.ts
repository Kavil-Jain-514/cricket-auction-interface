// convex/auctionLifecycle.ts - Putting a room live. Shared by
// auctions:startAuction and snapshots:startRehearsal, so a rehearsal starts
// exactly like the real auction.
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

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
