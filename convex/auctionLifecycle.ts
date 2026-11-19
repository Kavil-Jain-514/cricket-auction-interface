// convex/auctionLifecycle.ts - Putting a room live. Shared by
// auctions:startAuction and snapshots:startRehearsal, so a rehearsal starts
// exactly like the real auction. Also the one definition of "the auction has
// started", which locks team owners out of editing their team.
import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { logAdminAction, requireTournamentRole, type TournamentRole } from "./auth";
import { syncTournamentAuctionCounts } from "./auctionCounts";

/**
 * Load a room and authorize the caller on its tournament, in that order and
 * before any other validation (CLAUDE.md). A missing room throws: not-found
 * is the one case auction mutations throw for.
 */
export async function loadRoomForStaff(
  ctx: MutationCtx,
  auctionRoomId: Id<"auctionRooms">,
  roles: TournamentRole[],
): Promise<{ room: Doc<"auctionRooms">; user: Doc<"users"> }> {
  const room = await ctx.db.get(auctionRoomId);
  if (!room) throw new ConvexError("Auction room not found");
  const user = await requireTournamentRole(ctx, room.tournamentId, roles);
  return { room, user };
}

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

/**
 * End the auction: room and tournament "completed", nobody on the block,
 * counts resynced. With `audit`, logs "complete_auction" with its reason;
 * callers that log their own action (resolveStalledRound) leave it out.
 */
export async function completeAuction(
  ctx: MutationCtx,
  room: Doc<"auctionRooms">,
  audit?: { user: Doc<"users">; reason: string },
): Promise<{ success: true; completed: true }> {
  const now = Date.now();
  await Promise.all([
    ctx.db.patch(room._id, {
      status: "completed",
      currentPlayerId: undefined,
      bidTimerEndsAt: undefined,
      roundStalled: undefined,
      updatedAt: now,
    }),
    ctx.db.patch(room.tournamentId, { status: "completed", updatedAt: now }),
  ]);
  await syncTournamentAuctionCounts(ctx, room.tournamentId);
  if (audit) {
    await logAdminAction(ctx, {
      userId: audit.user._id,
      userEmail: audit.user.email,
      action: "complete_auction",
      targetType: "auction",
      targetId: room._id,
      newData: { reason: audit.reason },
      tournamentId: room.tournamentId,
      auctionRoomId: room._id,
    });
  }
  return { success: true, completed: true };
}
