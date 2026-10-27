// convex/idempotency.ts - Exactly-once console actions across reconnects.
// The console sends a client-generated requestId with placeBid,
// acceptBidRequest and finalizePlayerSale. The first call's result is stored
// per (room, kind, requestId); a retry with the same id (after a dropped
// socket, a double tap) returns that result without applying anything again.
// See OFFLINE_CONSOLE_DESIGN.md.
import { internalMutation, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireTournamentRole, RUN_AUCTION } from "./auth";

/** Keys are kept a day: far longer than any reconnect retry. */
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_KEY_LENGTH = 100;

export type IdempotentKind = "placeBid" | "acceptBidRequest" | "finalizePlayerSale";

/**
 * Run `apply` at most once per (room, kind, requestId). Without a requestId it
 * just runs (legacy callers). Access is checked before any stored result is
 * returned, so a key can't be used to read another organiser's outcome.
 */
export async function withIdempotency<T>(
  ctx: MutationCtx,
  kind: IdempotentKind,
  auctionRoomId: Id<"auctionRooms">,
  requestId: string | undefined,
  apply: () => Promise<T>,
): Promise<T> {
  if (requestId === undefined) return await apply();
  if (requestId.length === 0 || requestId.length > MAX_KEY_LENGTH) {
    throw new Error("Invalid requestId");
  }

  const room = await ctx.db.get(auctionRoomId);
  if (!room) throw new Error("Auction room not found");
  await requireTournamentRole(ctx, room.tournamentId, RUN_AUCTION);

  const key = `${kind}:${requestId}`;
  const seen = await ctx.db
    .query("bidRequestsSeen")
    .withIndex("by_room_key", (q) => q.eq("auctionRoomId", auctionRoomId).eq("key", key))
    .first();
  if (seen) return seen.result as T;

  const result = await apply();
  await ctx.db.insert("bidRequestsSeen", { key, auctionRoomId, result, createdAt: Date.now() });
  return result;
}

/** Daily cron (convex/crons.ts): forget keys older than TTL_MS. */
export const purgeOldRequests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("bidRequestsSeen")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", Date.now() - TTL_MS))
      .take(1000);
    await Promise.all(old.map((row) => ctx.db.delete(row._id)));
    return { deleted: old.length };
  },
});
