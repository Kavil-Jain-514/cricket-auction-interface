// convex/auctions.ts - Live auction mutations and queries
import { v } from "convex/values";
import { mutation, MutationCtx, query } from "./_generated/server";
import { Id, Doc } from "./_generated/dataModel";
import {
  getCurrentUser,
  getTournamentRole,
  logAdminAction,
  OWNER_ONLY,
  requireTournamentRole,
  RUN_AUCTION,
} from "./auth";
import { findOwnerMembership } from "./members";
import {
  applyBid,
  BID_SPACING_MS,
  expectedStateArgs,
  type ExpectedState,
  expirePendingRaises,
  latestLiveBid,
  loadBidContext,
  minNextBidFor,
  pendingRequestsFor,
  playerBasePriceFor,
  staleStateReason,
} from "./bidCore";
import {
  auctionCountsEqual,
  computeAuctionCounts,
  syncTournamentAuctionCounts,
} from "./auctionCounts";
import { toPublicPlayer } from "./projections";
import { nextPresentationSet } from "./presentation";
import { withIdempotency } from "./idempotency";
import { takeSnapshot } from "./snapshots";
import { goLive } from "./auctionLifecycle";
import { enqueueSoldNotification } from "./notifications";
import { confirmsTournamentName } from "./validation";
import {
  maxRuleViolation,
  minRuleShortfall,
  minRuleSlots,
  ruleStatus,
} from "./squadRules";
import {
  bidTimerEndsAt,
  bidTimerSeconds,
  effectiveBasePrice,
  teamPurseTotal,
  isSquadFull,
  maxAllowedBid,
  reserveBasePrice,
} from "./bidRules";

/** In-place Fisher–Yates shuffle. Used to reshuffle each unsold round's queue. */
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Round bookkeeping written alongside currentPlayerId when a player is presented.
type RoomRoundPatch = {
  auctionPhase?: "main" | "unsold";
  roundNumber?: number;
  unsoldQueue?: Id<"players">[];
  unsoldCursor?: number;
  unsoldRoundTotal?: number;
  currentSetId?: string;
};

/**
 * Create a new auction room for a tournament.
 *
 * Every client flow (resume, restart, viewer links) assumes exactly one room
 * per tournament and always resolves to auctionRooms[0] — restarting reuses
 * the same room rather than creating another. Enforce that invariant
 * server-side (not just in the UI) so two admins racing to create a room at
 * the same time can't both succeed and leave a second, unreachable room.
 */
export const createAuctionRoom = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);

    const existing = await ctx.db
      .query("auctionRooms")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .first();
    if (existing) {
      throw new Error("An auction room already exists for this tournament");
    }

    const tournament = await ctx.db.get(args.tournamentId);
    const auctionRoomId = await ctx.db.insert("auctionRooms", {
      tournamentId: args.tournamentId,
      name: args.name,
      status: "waiting",
      tournamentHidden: tournament?.isActive === false ? true : undefined,
      createdBy: user._id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return auctionRoomId;
  },
});

/** Start the auction — sets status to "live" and marks tournament as "active". */
export const startAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");
    const admin = await requireTournamentRole(ctx, auctionRoom.tournamentId, RUN_AUCTION);

    if (auctionRoom.status === "live") {
      return { success: true, message: "Auction already live" };
    }

    if (auctionRoom.status === "completed") {
      throw new Error("Auction has already completed");
    }

    // The state the auction starts from, so the day can always be rewound.
    if (auctionRoom.status === "waiting") {
      await takeSnapshot(ctx, auctionRoom.tournamentId, "before start_auction", admin._id);
    }
    await goLive(ctx, auctionRoom);

    return { success: true };
  },
});

/** Pause the auction — captures remaining timer so resume can restore it. */
export const pauseAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");
    const admin = await requireTournamentRole(ctx, auctionRoom.tournamentId, RUN_AUCTION);

    if (auctionRoom.status === "paused") {
      return { success: true, alreadyPaused: true };
    }

    let remainingTime = 0;
    if (auctionRoom.bidTimerEndsAt) {
      remainingTime = Math.max(
        0,
        Math.ceil((auctionRoom.bidTimerEndsAt - Date.now()) / 1000),
      );
    }

    const now = Date.now();
    await Promise.all([
      ctx.db.patch(args.auctionRoomId, {
        status: "paused",
        pausedTimeRemaining: remainingTime,
        bidTimerEndsAt: undefined,
        updatedAt: now,
      }),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "auction_paused",
        data: { remainingTime },
        timestamp: now,
      }),
      logAdminAction(ctx, {
        userId: admin._id,
        userEmail: admin.email,
        action: "pause_auction",
        targetType: "auction",
        targetId: args.auctionRoomId,
        previousData: { status: auctionRoom.status },
        newData: { status: "paused", remainingTime },
        tournamentId: auctionRoom.tournamentId,
        auctionRoomId: args.auctionRoomId,
      }),
    ]);

    return { success: true, remainingTime };
  },
});

/**
 * Resume a paused auction. Restores the timer to the captured `pausedTimeRemaining`
 * or falls back to the tournament default if no pause time was saved.
 */
export const resumeAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");
    const admin = await requireTournamentRole(ctx, auctionRoom.tournamentId, RUN_AUCTION);

    if (auctionRoom.status === "live") {
      return { success: true, alreadyLive: true };
    }

    if (auctionRoom.status !== "paused") {
      throw new Error("Auction is not paused");
    }

    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const now = Date.now();
    const timerDuration = auctionRoom.pausedTimeRemaining
      ? auctionRoom.pausedTimeRemaining * 1000
      : bidTimerSeconds(tournament.settings) * 1000;

    const updates: Record<string, unknown> = {
      status: "live",
      pausedTimeRemaining: undefined,
      updatedAt: now,
    };

    // timerDuration is 0 only when the timer is off: then no countdown resumes.
    if (auctionRoom.currentPlayerId && timerDuration > 0) {
      updates.bidTimerEndsAt = now + timerDuration;
    }

    await Promise.all([
      ctx.db.patch(args.auctionRoomId, updates),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "auction_resumed",
        data: {},
        timestamp: now,
      }),
      logAdminAction(ctx, {
        userId: admin._id,
        userEmail: admin.email,
        action: "resume_auction",
        targetType: "auction",
        targetId: args.auctionRoomId,
        previousData: { status: auctionRoom.status },
        newData: { status: "live" },
        tournamentId: auctionRoom.tournamentId,
        auctionRoomId: args.auctionRoomId,
      }),
    ]);

    return { success: true };
  },
});

// FAST BID - Only writes to liveBids table, NO auctionRoom update (Admin only)
export const placeBid = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
    teamId: v.id("teams"),
    amount: v.number(),
    // Client-generated; a retry with the same id is a no-op (idempotency.ts).
    requestId: v.optional(v.string()),
    // What the console saw when it bid (bidCore.ts staleStateReason).
    ...expectedStateArgs,
  },
  handler: (ctx, args) =>
    withIdempotency(ctx, "placeBid", args.auctionRoomId, args.requestId, () => placeBidImpl(ctx, args)),
});

async function placeBidImpl(
  ctx: MutationCtx,
  args: { auctionRoomId: Id<"auctionRooms">; teamId: Id<"teams">; amount: number } & ExpectedState,
) {
  // Only the tournament's staff can call bids from the console
  const auctionRoom = await ctx.db.get(args.auctionRoomId);
  if (!auctionRoom) throw new Error("Auction room not found");
  const admin = await requireTournamentRole(ctx, auctionRoom.tournamentId, RUN_AUCTION);

  const team = await ctx.db.get(args.teamId);
  if (!team) throw new Error("Team not found");

  // Validation + write live in bidCore.ts, shared with owner raises.
  return await applyBid(ctx, {
    room: auctionRoom,
    team,
    amount: args.amount,
    source: "admin",
    userId: admin._id,
    expectedPlayerId: args.expectedPlayerId,
    expectedCurrentBid: args.expectedCurrentBid,
  });
}

/**
 * Owner raise from the bidding paddle. The caller's team is resolved from
 * their membership — there is no teamId argument, so an owner can only ever
 * bid for their own team. `amount` defaults to the minimum valid next bid.
 *
 * - bidMode "open": the raise is applied immediately via applyBid.
 * - bidMode "confirm": applyBid runs as a dry run, then a pending bidRequest
 *   is queued for the auctioneer (superseding this team's previous one). The
 *   room is not patched, so getLiveAuction does not re-run for it.
 */
export const raiseBid = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
    amount: v.optional(v.number()),
    // What the paddle showed when the owner tapped (bidCore.ts staleStateReason).
    ...expectedStateArgs,
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    const user = await getCurrentUser(ctx);
    if (!user) return { success: false as const, reason: "Sign in to bid" };

    const membership = await findOwnerMembership(
      ctx,
      user._id,
      auctionRoom.tournamentId,
    );
    if (!membership) {
      return {
        success: false as const,
        reason: "You are not an owner in this auction",
      };
    }

    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");
    const bidMode = tournament.settings.bidMode ?? "admin_only";
    if (bidMode === "admin_only") {
      return { success: false as const, reason: "Owner bidding is off" };
    }

    const team = await ctx.db.get(membership.teamId);
    if (!team) throw new Error("Team not found");

    const bid = {
      room: auctionRoom,
      team,
      amount: args.amount,
      source: "owner" as const,
      userId: user._id,
      expectedPlayerId: args.expectedPlayerId,
      expectedCurrentBid: args.expectedCurrentBid,
    };
    if (bidMode === "open") return await applyBid(ctx, bid);

    const check = await applyBid(ctx, { ...bid, dryRun: true });
    if (!check.success) return check;
    const playerId = auctionRoom.currentPlayerId!;

    const lastRequest = await ctx.db
      .query("bidRequests")
      .withIndex("by_team", (q) => q.eq("teamId", team._id))
      .order("desc")
      .first();
    if (lastRequest && Date.now() - lastRequest.createdAt < BID_SPACING_MS) {
      return {
        success: false as const,
        reason: "Please wait before bidding again",
      };
    }

    // One pending raise per team: the newest replaces the older one.
    const pending = await pendingRequestsFor(ctx, auctionRoom._id, playerId);
    await Promise.all(
      pending
        .filter((r) => r.teamId === team._id)
        .map((r) => ctx.db.patch(r._id, { status: "superseded" })),
    );

    const latest = await latestLiveBid(ctx, playerId);
    const requestId = await ctx.db.insert("bidRequests", {
      auctionRoomId: auctionRoom._id,
      playerId,
      teamId: team._id,
      userId: user._id,
      amount: check.amount,
      status: "pending",
      basedOnBid: latest?.amount ?? null,
      createdAt: Date.now(),
    });

    return {
      success: true as const,
      pending: true,
      requestId,
      amount: check.amount,
      teamId: team._id,
    };
  },
});

/**
 * Auctioneer accepts an owner's raise. Re-validated through applyBid because
 * the price may have moved since the owner raised; a stale request is marked
 * rejected with the reason. On success, other pending raises at or below the
 * new price are superseded.
 */
export const acceptBidRequest = mutation({
  args: {
    requestId: v.id("bidRequests"),
    // Client-generated retry key (named so it doesn't clash with requestId,
    // the raise being accepted); a repeat is a no-op (idempotency.ts).
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Bid request not found");
    return await withIdempotency(ctx, "acceptBidRequest", request.auctionRoomId, args.idempotencyKey, () =>
      acceptBidRequestImpl(ctx, { requestId: args.requestId }),
    );
  },
});

async function acceptBidRequestImpl(ctx: MutationCtx, args: { requestId: Id<"bidRequests"> }) {
  const request = await ctx.db.get(args.requestId);
  if (!request) throw new Error("Bid request not found");
  const auctionRoom = await ctx.db.get(request.auctionRoomId);
  if (!auctionRoom) throw new Error("Auction room not found");
  const admin = await requireTournamentRole(ctx, auctionRoom.tournamentId, RUN_AUCTION);
  if (request.status !== "pending") {
    return { success: false as const, reason: "Request is no longer pending" };
  }

  if (auctionRoom.currentPlayerId !== request.playerId) {
    await ctx.db.patch(request._id, {
      status: "superseded",
      reason: "Player is no longer up",
    });
    return { success: false as const, reason: "Player is no longer up" };
  }

  const membership = await findOwnerMembership(
    ctx,
    request.userId,
    auctionRoom.tournamentId,
  );
  if (membership?.teamId !== request.teamId) {
    await ctx.db.patch(request._id, {
      status: "rejected",
      reason: "Owner removed",
    });
    return { success: false as const, reason: "Owner removed" };
  }

  const team = await ctx.db.get(request.teamId);
  if (!team) throw new Error("Team not found");

  // Only at the price the owner raised from (absent on legacy requests).
  const result = await applyBid(ctx, {
    room: auctionRoom,
    team,
    amount: request.amount,
    source: "owner",
    userId: request.userId,
    expectedPlayerId: request.playerId,
    expectedCurrentBid: request.basedOnBid,
  });
  if (!result.success) {
    await ctx.db.patch(request._id, {
      status: "rejected",
      reason: result.reason,
    });
    return result;
  }

  // applyBid expired every pending raise on this player, this one included.
  await Promise.all([
    ctx.db.patch(request._id, { status: "accepted", reason: undefined }),
    logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "accept_bid_request",
      targetType: "auction",
      targetId: auctionRoom._id,
      newData: {
        requestId: request._id,
        playerId: request.playerId,
        teamId: request.teamId,
        ownerUserId: request.userId,
        amount: request.amount,
      },
      tournamentId: auctionRoom.tournamentId,
      auctionRoomId: auctionRoom._id,
    }),
  ]);

  return result;
}

/** Auctioneer declines an owner's raise. */
export const rejectBidRequest = mutation({
  args: {
    requestId: v.id("bidRequests"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Bid request not found");
    const auctionRoom = await ctx.db.get(request.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");
    const admin = await requireTournamentRole(ctx, auctionRoom.tournamentId, RUN_AUCTION);
    if (request.status !== "pending") {
      return { success: false as const, reason: "Request is no longer pending" };
    }

    const reason = args.reason?.trim().slice(0, 200) || "Declined by the auctioneer";

    await Promise.all([
      ctx.db.patch(request._id, { status: "rejected", reason }),
      logAdminAction(ctx, {
        userId: admin._id,
        userEmail: admin.email,
        action: "reject_bid_request",
        targetType: "auction",
        targetId: request.auctionRoomId,
        newData: {
          requestId: request._id,
          playerId: request.playerId,
          teamId: request.teamId,
          ownerUserId: request.userId,
          amount: request.amount,
          reason,
        },
        tournamentId: auctionRoom?.tournamentId,
        auctionRoomId: request.auctionRoomId,
      }),
    ]);

    return { success: true as const };
  },
});

/**
 * Finalize the current player's auction — either SOLD or UNSOLD.
 * - SOLD: assigns player to team, deducts from purse, archives bid history.
 * - UNSOLD: marks player unsold and clears current player from room.
 * Live bids are deleted after finalization; the winning bid is archived to `bids`.
 */
export const finalizePlayerSale = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
    // Client-generated; a retry with the same id is a no-op (idempotency.ts).
    requestId: v.optional(v.string()),
    // The player and price the Sell was based on (bidCore.ts staleStateReason).
    ...expectedStateArgs,
  },
  handler: (ctx, args) =>
    withIdempotency(ctx, "finalizePlayerSale", args.auctionRoomId, args.requestId, () =>
      finalizePlayerSaleImpl(ctx, args),
    ),
});

async function finalizePlayerSaleImpl(
  ctx: MutationCtx,
  args: { auctionRoomId: Id<"auctionRooms"> } & ExpectedState,
) {
  const auctionRoom = await ctx.db.get(args.auctionRoomId);
  if (!auctionRoom) throw new Error("Auction room not found");
  const admin = await requireTournamentRole(ctx, auctionRoom.tournamentId, RUN_AUCTION);

  if (auctionRoom.status !== "live") {
    return { success: false, reason: "Auction is not live" };
  }

  const currentPlayerId = auctionRoom.currentPlayerId;
  if (!currentPlayerId) {
    return { success: false, reason: "No player in auction" };
  }

  const winningBid = await ctx.db
    .query("liveBids")
    .withIndex("by_player", (q) => q.eq("playerId", currentPlayerId))
    .order("desc")
    .first();

  const stale = staleStateReason(auctionRoom, winningBid, args);
  if (stale) return { success: false, reason: stale };
  await expirePendingRaises(ctx, auctionRoom._id, currentPlayerId, "Player left the block");

  const player = await ctx.db.get(currentPlayerId);
  if (!player) throw new Error("Player not found");

  const tournament = await ctx.db.get(auctionRoom.tournamentId);
  if (!tournament) throw new Error("Tournament not found");

  const playerBasePrice = playerBasePriceFor(player, tournament);

  const now = Date.now();
  const result = {
    playerName: player.name,
    teamName: null as string | null,
    amount: winningBid?.amount || playerBasePrice,
    sold: false,
  };

  if (winningBid) {
    // PLAYER SOLD
    const team = await ctx.db.get(winningBid.teamId);
    if (!team) throw new Error("Winning team not found");

    // Defensive: placeBid already checked the purse, but a correction since
    // then could have lowered it. Never debit a team below zero.
    if (team.purseRemaining < winningBid.amount) {
      return {
        success: false,
        reason: `${team.name} can no longer afford this bid (₹${team.purseRemaining} left, bid ₹${winningBid.amount}). Revert the bid or restart the player.`,
      };
    }

    result.teamName = team.name;
    result.sold = true;

    const allLiveBids = await ctx.db
      .query("liveBids")
      .withIndex("by_player", (q) => q.eq("playerId", currentPlayerId))
      .collect();

    await Promise.all([
      ctx.db.patch(currentPlayerId, {
        teamId: winningBid.teamId,
        soldPrice: winningBid.amount,
        auctionStatus: "sold",
        updatedAt: now,
      }),
      ctx.db.patch(winningBid.teamId, {
        purseRemaining: team.purseRemaining - winningBid.amount,
        purseSpent: team.purseSpent + winningBid.amount,
        updatedAt: now,
      }),
      ctx.db.patch(args.auctionRoomId, {
        currentPlayerId: undefined,
        bidTimerEndsAt: undefined,
        updatedAt: now,
      }),
      ctx.db.insert("bids", {
        auctionRoomId: args.auctionRoomId,
        playerId: currentPlayerId,
        teamId: winningBid.teamId,
        amount: winningBid.amount,
        timestamp: winningBid.timestamp,
        isFinal: true,
        source: winningBid.source,
        userId: winningBid.userId,
      }),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "player_sold",
        data: {
          playerId: currentPlayerId,
          teamId: winningBid.teamId,
          amount: winningBid.amount,
          playerName: player.name,
          teamName: team.name,
          // Only the winning bid is archived to `bids`, so keep the count
          // here for the results export's sale log.
          bidCount: allLiveBids.length,
        },
        timestamp: now,
      }),
      ...allLiveBids.map((bid) => ctx.db.delete(bid._id)),
    ]);

    // WhatsApp to the sold player: only a row in the outbox here, sent by a
    // separate worker, so messaging can never affect the sale (P1-14).
    // Never during a rehearsal: those sales are rewound.
    if (!auctionRoom.rehearsal) {
      await enqueueSoldNotification(ctx, {
        player,
        team,
        tournament,
        soldPrice: winningBid.amount,
      });
    }
  } else {
    // PLAYER UNSOLD
    await Promise.all([
      ctx.db.patch(currentPlayerId, {
        auctionStatus: "unsold",
        updatedAt: now,
      }),
      ctx.db.patch(args.auctionRoomId, {
        currentPlayerId: undefined,
        bidTimerEndsAt: undefined,
        updatedAt: now,
      }),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "player_unsold",
        // basePrice is stored on the event so getLatestSaleEvent can show the
        // unsold amount WITHOUT reading the (per-bid-mutated) room doc. (P1-2)
        data: {
          playerId: currentPlayerId,
          playerName: player.name,
          basePrice: playerBasePrice,
        },
        timestamp: now,
      }),
    ]);
  }

  // Refresh denormalized counts now that this player left "in_auction" for
  // "sold"/"unsold" (keeps getAuctionRoster's stats + bid limits correct).
  await syncTournamentAuctionCounts(ctx, auctionRoom.tournamentId);

  await logAdminAction(ctx, {
    userId: admin._id,
    userEmail: admin.email,
    action: result.sold ? "player_sold" : "player_unsold",
    targetType: "player",
    targetId: currentPlayerId,
    newData: {
      playerName: result.playerName,
      teamName: result.teamName,
      amount: result.amount,
      sold: result.sold,
    },
    tournamentId: auctionRoom.tournamentId,
    auctionRoomId: args.auctionRoomId,
  });

  return { ...result, success: true };
}

/**
 * Mark the player currently in auction as FINAL UNSOLD — a terminal state.
 *
 * Used during the unsold (second) round when an admin decides a player will not
 * play for any team. The player is removed from the auction pool entirely:
 * startNextPlayer only draws from "pending" / "unsold", so a "final_unsold"
 * player is never picked again, and the counts/history queries ignore it too.
 */
export const markPlayerFinalUnsold = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
    expectedPlayerId: expectedStateArgs.expectedPlayerId,
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");
    const admin = await requireTournamentRole(ctx, auctionRoom.tournamentId, RUN_AUCTION);

    if (auctionRoom.status !== "live") {
      return { success: false, reason: "Auction is not live" };
    }

    const currentPlayerId = auctionRoom.currentPlayerId;
    if (!currentPlayerId) {
      return { success: false, reason: "No player in auction" };
    }
    const stale = staleStateReason(auctionRoom, null, {
      expectedPlayerId: args.expectedPlayerId,
    });
    if (stale) return { success: false, reason: stale };
    await expirePendingRaises(ctx, auctionRoom._id, currentPlayerId, "Player left the block");

    const player = await ctx.db.get(currentPlayerId);
    if (!player) throw new Error("Player not found");

    // Resolve the effective base price now so it can be stored on the event
    // (lets getLatestSaleEvent avoid a per-bid room read — P1-2).
    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    const playerBasePrice = effectiveBasePrice(
      player,
      tournament?.settings ?? {},
    );

    // Clear any live bids placed on this player before removing them.
    const liveBids = await ctx.db
      .query("liveBids")
      .withIndex("by_player", (q) => q.eq("playerId", currentPlayerId))
      .collect();

    const now = Date.now();
    await Promise.all([
      ctx.db.patch(currentPlayerId, {
        auctionStatus: "final_unsold",
        teamId: undefined,
        soldPrice: undefined,
        updatedAt: now,
      }),
      ctx.db.patch(args.auctionRoomId, {
        currentPlayerId: undefined,
        bidTimerEndsAt: undefined,
        updatedAt: now,
      }),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "player_unsold",
        data: {
          playerId: currentPlayerId,
          playerName: player.name,
          basePrice: playerBasePrice,
          final: true,
        },
        timestamp: now,
      }),
      ...liveBids.map((bid) => ctx.db.delete(bid._id)),
    ]);

    // Player left "in_auction" for the terminal "final_unsold" state — refresh
    // the denormalized counts so stats + bid limits stay correct.
    await syncTournamentAuctionCounts(ctx, auctionRoom.tournamentId);

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "player_final_unsold",
      targetType: "player",
      targetId: currentPlayerId,
      newData: { playerName: player.name },
      tournamentId: auctionRoom.tournamentId,
      auctionRoomId: args.auctionRoomId,
    });

    return { success: true, playerName: player.name };
  },
});

/**
 * Pick and start the next player from the pending pool (random selection).
 * Falls back to unsold players if no pending players remain.
 * Marks the auction/tournament as completed when all squads are full or no players are left.
 */
export const startNextPlayer = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");
    const admin = await requireTournamentRole(ctx, auctionRoom.tournamentId, RUN_AUCTION);

    if (auctionRoom.status !== "live") {
      throw new Error("Auction must be live to get next player");
    }

    // Guard: refuse to load a new player while one is still in auction.
    // The UI disables the "Next" button, but that is client-only — two admin
    // tabs (or a click that races the subscription update) could otherwise
    // overwrite currentPlayerId and orphan the in-auction player. Finalize the
    // current player first.
    if (auctionRoom.currentPlayerId) {
      return {
        success: false,
        completed: false,
        reason: "A player is already in auction. Finalize the current player first.",
      };
    }

    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Check if all teams have filled their squads
    const maxPlayersPerTeam = tournament.settings.maxPlayersPerTeam;
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", auctionRoom.tournamentId),
      )
      .collect();

    if (teams.length > 0) {
      const soldPlayers = await ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q
            .eq("tournamentId", auctionRoom.tournamentId)
            .eq("auctionStatus", "sold"),
        )
        .collect();

      // Build O(n) count map instead of O(n*m) nested filter
      const soldCountByTeam = new Map<string, number>();
      for (const p of soldPlayers) {
        if (p.teamId) {
          soldCountByTeam.set(
            p.teamId,
            (soldCountByTeam.get(p.teamId) ?? 0) + 1,
          );
        }
      }

      const allSquadsFull = teams.every(
        (team) => (soldCountByTeam.get(team._id) ?? 0) >= maxPlayersPerTeam,
      );

      if (allSquadsFull) {
        const now = Date.now();
        await Promise.all([
          ctx.db.patch(args.auctionRoomId, {
            status: "completed",
            currentPlayerId: undefined,
            bidTimerEndsAt: undefined,
            updatedAt: now,
          }),
          ctx.db.patch(auctionRoom.tournamentId, {
            status: "completed",
            updatedAt: now,
          }),
          logAdminAction(ctx, {
            userId: admin._id,
            userEmail: admin.email,
            action: "complete_auction",
            targetType: "auction",
            targetId: args.auctionRoomId,
            newData: { reason: "all squads full" },
            tournamentId: auctionRoom.tournamentId,
            auctionRoomId: args.auctionRoomId,
          }),
        ]);
        return { success: true, completed: true };
      }
    }

    // Team captains are pre-assigned and must never be put up for auction.
    const captainPlayerIds = new Set(
      teams
        .map((t) => t.captainPlayerId)
        .filter((id): id is NonNullable<typeof id> => Boolean(id)),
    );

    // Get all pending players and pick randomly (excluding captains)
    const pendingPlayers = (
      await ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q
            .eq("tournamentId", auctionRoom.tournamentId)
            .eq("auctionStatus", "pending"),
        )
        .collect()
    ).filter((p) => !captainPlayerIds.has(p._id));

    // Put a player into the auction ring and broadcast it. `roomPatch` carries
    // the round bookkeeping (phase / roundNumber / queue cursor) for this case.
    const presentPlayer = async (
      player: Doc<"players">,
      roomPatch: RoomRoundPatch,
    ) => {
      const now = Date.now();
      const basePrice = playerBasePriceFor(player, tournament);
      await Promise.all([
        ctx.db.patch(player._id, {
          auctionStatus: "in_auction",
          updatedAt: now,
        }),
        ctx.db.patch(args.auctionRoomId, {
          currentPlayerId: player._id,
          bidTimerEndsAt: bidTimerEndsAt(tournament.settings, now),
          roundStalled: undefined,
          updatedAt: now,
          ...roomPatch,
        }),
        ctx.db.insert("auctionEvents", {
          auctionRoomId: args.auctionRoomId,
          type: "player_started",
          data: { playerId: player._id, playerName: player.name, basePrice },
          timestamp: now,
        }),
        logAdminAction(ctx, {
          userId: admin._id,
          userEmail: admin.email,
          action: "start_next_player",
          targetType: "player",
          targetId: player._id,
          newData: { playerName: player.name, basePrice },
          tournamentId: auctionRoom.tournamentId,
          auctionRoomId: args.auctionRoomId,
        }),
      ]);
      // The picked player just moved pending/unsold -> in_auction; refresh counts.
      await syncTournamentAuctionCounts(ctx, auctionRoom.tournamentId);
      return { success: true, player };
    };

    const completeAuction = async () => {
      const now = Date.now();
      await Promise.all([
        ctx.db.patch(args.auctionRoomId, {
          status: "completed",
          currentPlayerId: undefined,
          bidTimerEndsAt: undefined,
          roundStalled: undefined,
          updatedAt: now,
        }),
        ctx.db.patch(auctionRoom.tournamentId, {
          status: "completed",
          updatedAt: now,
        }),
        logAdminAction(ctx, {
          userId: admin._id,
          userEmail: admin.email,
          action: "complete_auction",
          targetType: "auction",
          targetId: args.auctionRoomId,
          newData: { reason: "no players left" },
          tournamentId: auctionRoom.tournamentId,
          auctionRoomId: args.auctionRoomId,
        }),
      ]);
      return { success: true, completed: true };
    };

    // ── Main round: dynamic random pick from the pending pool ────────────────
    // With presentationOrder "by_category" the pool is narrowed to the current
    // set first (see presentation.ts). Entering a new named set announces it
    // WITHOUT loading a player, exactly like the unsold-round banner below:
    // clients show "Now: <set>", then the auto-loader calls back in.
    if (pendingPlayers.length > 0) {
      let pool = pendingPlayers;
      let setPatch: RoomRoundPatch = {};
      if (tournament.settings.presentationOrder === "by_category") {
        const set = nextPresentationSet(
          pendingPlayers,
          tournament.settings.categories,
        )!;
        if (set.category && set.setId !== auctionRoom.currentSetId) {
          await ctx.db.patch(args.auctionRoomId, {
            auctionPhase: "main",
            roundNumber: 1,
            currentSetId: set.setId,
            currentPlayerId: undefined,
            bidTimerEndsAt: undefined,
            updatedAt: Date.now(),
          });
          return { success: true, completed: false, enteredSet: set.setId };
        }
        pool = set.players;
        setPatch = { currentSetId: set.setId };
      }
      const nextPlayer = pool[Math.floor(Math.random() * pool.length)];
      return await presentPlayer(nextPlayer, {
        auctionPhase: "main",
        roundNumber: 1,
        ...setPatch,
      });
    }

    // ── Unsold rounds ────────────────────────────────────────────────────────
    const unsoldPlayers = (
      await ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q
            .eq("tournamentId", auctionRoom.tournamentId)
            .eq("auctionStatus", "unsold"),
        )
        .collect()
    ).filter((p) => !captainPlayerIds.has(p._id));

    // Everyone is sold or final_unsold → the cycle is over.
    if (unsoldPlayers.length === 0) {
      return await completeAuction();
    }

    const unsoldIds = new Set(unsoldPlayers.map((p) => p._id));

    // First crossing main → unsold: announce the round (drives the one-time
    // banner on every client) and build round 2's queue WITHOUT loading a
    // player. The client shows the banner, then the auto-loader calls back in
    // to present the first player — so the banner is never overridden.
    if (auctionRoom.auctionPhase !== "unsold") {
      const queue = shuffleInPlace(unsoldPlayers.map((p) => p._id));
      const now = Date.now();
      await ctx.db.patch(args.auctionRoomId, {
        auctionPhase: "unsold",
        roundNumber: 2,
        unsoldQueue: queue,
        unsoldCursor: 0,
        unsoldRoundTotal: queue.length,
        roundStalled: undefined,
        currentPlayerId: undefined,
        bidTimerEndsAt: undefined,
        updatedAt: now,
      });
      return { success: true, completed: false, enteredUnsoldRound: true };
    }

    // Mid-round: present the next queued player that is still unsold. The
    // status check skips anyone sold or marked final_unsold since the queue was
    // built (so a final_unsold player is never re-presented, even mid-round).
    const queue = auctionRoom.unsoldQueue ?? [];
    let cursor = auctionRoom.unsoldCursor ?? 0;
    while (cursor < queue.length) {
      const pid = queue[cursor];
      cursor++;
      if (unsoldIds.has(pid)) {
        const player = await ctx.db.get(pid);
        if (player) {
          return await presentPlayer(player, {
            auctionPhase: "unsold",
            unsoldCursor: cursor,
          });
        }
      }
    }

    // Round complete. Infinite-loop guard: the round made progress iff at least
    // one player from THIS round's snapshot queue left the unsold pool (got
    // sold or marked final_unsold). Compare membership against the snapshot —
    // not just counts — because the count can stay equal while membership
    // changes (e.g. a queued player sells while another becomes unsold via an
    // admin action). Only stall when every queued player is still unsold.
    const noProgress =
      queue.length > 0 && queue.every((pid) => unsoldIds.has(pid));
    if (noProgress) {
      const now = Date.now();
      await ctx.db.patch(args.auctionRoomId, {
        roundStalled: true,
        currentPlayerId: undefined,
        bidTimerEndsAt: undefined,
        updatedAt: now,
      });
      return { success: true, completed: false, stalled: true };
    }

    // Progress was made → roll into the next unsold round (reshuffled). No
    // banner for subsequent rounds; load the first player immediately.
    const nextQueue = shuffleInPlace(unsoldPlayers.map((p) => p._id));
    const nextRound = (auctionRoom.roundNumber ?? 2) + 1;
    const first = await ctx.db.get(nextQueue[0]);
    if (!first) return await completeAuction();
    return await presentPlayer(first, {
      auctionPhase: "unsold",
      roundNumber: nextRound,
      unsoldQueue: nextQueue,
      unsoldCursor: 1,
      unsoldRoundTotal: nextQueue.length,
    });
  },
});

/**
 * Resolve a stalled unsold round (see the infinite-loop guard in
 * startNextPlayer). The admin chooses one of three actions:
 *   - "continue": run another unsold round with the same players (reshuffled).
 *   - "finalizeUnsold": mark every remaining unsold player final_unsold and end.
 *   - "end": end the auction, leaving the remaining players as unsold.
 */
export const resolveStalledRound = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
    action: v.union(
      v.literal("continue"),
      v.literal("finalizeUnsold"),
      v.literal("end"),
    ),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");
    const admin = await requireTournamentRole(ctx, auctionRoom.tournamentId, RUN_AUCTION);
    if (!auctionRoom.roundStalled) {
      // Idempotent: nothing to resolve (another tab already handled it).
      return { success: true, alreadyResolved: true };
    }

    const teams = await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", auctionRoom.tournamentId),
      )
      .collect();
    const captainPlayerIds = new Set(
      teams
        .map((t) => t.captainPlayerId)
        .filter((id): id is NonNullable<typeof id> => Boolean(id)),
    );

    const unsoldPlayers = (
      await ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q
            .eq("tournamentId", auctionRoom.tournamentId)
            .eq("auctionStatus", "unsold"),
        )
        .collect()
    ).filter((p) => !captainPlayerIds.has(p._id));

    const now = Date.now();

    const endAuction = async () => {
      await Promise.all([
        ctx.db.patch(args.auctionRoomId, {
          status: "completed",
          currentPlayerId: undefined,
          bidTimerEndsAt: undefined,
          roundStalled: undefined,
          updatedAt: now,
        }),
        ctx.db.patch(auctionRoom.tournamentId, {
          status: "completed",
          updatedAt: now,
        }),
      ]);
      await syncTournamentAuctionCounts(ctx, auctionRoom.tournamentId);
      return { success: true, completed: true };
    };

    const audit = (action: string, newData: unknown) =>
      logAdminAction(ctx, {
        userId: admin._id,
        userEmail: admin.email,
        action,
        targetType: "auction",
        targetId: args.auctionRoomId,
        newData,
        tournamentId: auctionRoom.tournamentId,
        auctionRoomId: args.auctionRoomId,
      });

    if (args.action === "end") {
      await audit("end_auction_stalled_round", {
        unsoldLeft: unsoldPlayers.map((p) => p._id),
      });
      return await endAuction();
    }

    if (args.action === "finalizeUnsold") {
      // Remove everyone still unsold from the auction, then end. The patches are
      // independent per player, so run them concurrently.
      await Promise.all(
        unsoldPlayers.map((p) =>
          ctx.db.patch(p._id, {
            auctionStatus: "final_unsold",
            teamId: undefined,
            soldPrice: undefined,
            updatedAt: now,
          }),
        ),
      );
      await audit("final_unsold_stalled_round", {
        players: unsoldPlayers.map((p) => ({ playerId: p._id, name: p.name })),
      });
      return await endAuction();
    }

    // action === "continue": start another unsold round anyway (reshuffled).
    if (unsoldPlayers.length === 0) {
      return await endAuction();
    }
    const nextQueue = shuffleInPlace(unsoldPlayers.map((p) => p._id));
    const nextRound = (auctionRoom.roundNumber ?? 2) + 1;
    await ctx.db.patch(args.auctionRoomId, {
      auctionPhase: "unsold",
      roundNumber: nextRound,
      unsoldQueue: nextQueue,
      unsoldCursor: 0,
      unsoldRoundTotal: nextQueue.length,
      roundStalled: undefined,
      currentPlayerId: undefined,
      bidTimerEndsAt: undefined,
      updatedAt: now,
    });

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "continue_stalled_unsold_round",
      targetType: "auction",
      targetId: args.auctionRoomId,
      newData: { roundNumber: nextRound, players: nextQueue.length },
      tournamentId: auctionRoom.tournamentId,
      auctionRoomId: args.auctionRoomId,
    });

    // currentPlayerId is cleared and roundStalled false → the client auto-loader
    // presents the first player of the new round.
    return { success: true, roundNumber: nextRound };
  },
});

/** Remove the most recent bid for the current player (undo last bid). */
export const revertLastBid = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
    // The bid being reverted is the one the console saw on top, so a double
    // confirm or a second console can't remove a second bid (P1-1).
    ...expectedStateArgs,
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");
    const admin = await requireTournamentRole(ctx, auctionRoom.tournamentId, RUN_AUCTION);

    if (!auctionRoom.currentPlayerId) {
      throw new Error("No player currently in auction");
    }

    const latestBid = await ctx.db
      .query("liveBids")
      .withIndex("by_player", (q) =>
        q.eq("playerId", auctionRoom.currentPlayerId!),
      )
      .order("desc")
      .first();

    const stale = staleStateReason(auctionRoom, latestBid, args);
    if (stale) return { success: false as const, reason: stale };

    if (!latestBid) {
      throw new Error("No bids to revert");
    }

    await ctx.db.delete(latestBid._id);
    await expirePendingRaises(ctx, auctionRoom._id, latestBid.playerId, "Price moved");

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "revert_last_bid",
      targetType: "auction",
      targetId: args.auctionRoomId,
      previousData: {
        playerId: latestBid.playerId,
        teamId: latestBid.teamId,
        amount: latestBid.amount,
      },
      tournamentId: auctionRoom.tournamentId,
      auctionRoomId: args.auctionRoomId,
    });

    return { success: true as const };
  },
});

/**
 * Restart bidding for the current player — clears ALL live bids and resets the
 * timer to the tournament default. The player remains in_auction.
 */
export const restartCurrentPlayer = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
    expectedPlayerId: expectedStateArgs.expectedPlayerId,
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");
    const admin = await requireTournamentRole(ctx, auctionRoom.tournamentId, RUN_AUCTION);

    if (!auctionRoom.currentPlayerId) {
      throw new Error("No player currently in auction");
    }
    const stale = staleStateReason(auctionRoom, null, {
      expectedPlayerId: args.expectedPlayerId,
    });
    if (stale) return { success: false as const, reason: stale };

    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Delete all bids for the current player
    const allBids = await ctx.db
      .query("liveBids")
      .withIndex("by_player", (q) =>
        q.eq("playerId", auctionRoom.currentPlayerId!),
      )
      .collect();

    const now = Date.now();

    // Delete bids in bounded chunks (consistent with other mutations in this file).
    const CHUNK = 200;
    for (let i = 0; i < allBids.length; i += CHUNK) {
      await Promise.all(
        allBids.slice(i, i + CHUNK).map((bid) => ctx.db.delete(bid._id)),
      );
    }

    await expirePendingRaises(ctx, auctionRoom._id, auctionRoom.currentPlayerId, "Price moved");

    // Reset the timer and record the event once all deletes are done.
    await Promise.all([
      ctx.db.patch(args.auctionRoomId, {
        bidTimerEndsAt: bidTimerEndsAt(tournament.settings, now),
        updatedAt: now,
      }),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "player_restarted",
        data: { playerId: auctionRoom.currentPlayerId },
        timestamp: now,
      }),
      logAdminAction(ctx, {
        userId: admin._id,
        userEmail: admin.email,
        action: "restart_current_player",
        targetType: "auction",
        targetId: args.auctionRoomId,
        previousData: {
          playerId: auctionRoom.currentPlayerId,
          bidCount: allBids.length,
        },
        tournamentId: auctionRoom.tournamentId,
        auctionRoomId: args.auctionRoomId,
      }),
    ]);

    return { success: true as const };
  },
});

/**
 * HOT query — subscribed by every viewer and re-sent on every bid / timer reset.
 *
 * Kept deliberately small so that with 150+ concurrent viewers, a bid only
 * fans out a lightweight payload (room + live bids), NOT the full roster. It
 * reads the auctionRoom document (which changes each bid) and the current
 * player's live bids only — it does NOT scan the players or teams tables.
 *
 * The heavy roster data (teams, sold players, stats, current-player details)
 * lives in `getAuctionRoster`, which is keyed on tournamentId + currentPlayerId
 * so it is NOT invalidated by per-bid room patches.
 */
export const getLiveAuction = query({
  args: { auctionRoomId: v.id("auctionRooms") },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) return null;
    // Identity is read only for a deactivated tournament, so the normal
    // result stays shared across every viewer (P1-12).
    if (
      auctionRoom.tournamentHidden &&
      !(await getTournamentRole(ctx, auctionRoom.tournamentId))
    ) {
      return null;
    }

    let currentBidTeam: {
      _id: Id<"teams">;
      name: string;
      logoUrl?: string;
      colorPrimary: string;
    } | null = null;
    let currentBidAmount: number | undefined = undefined;
    let currentBidTeamId: string | undefined = undefined;
    let recentBids: Array<{
      _id: string;
      teamId: string;
      amount: number;
      timestamp: number;
    }> = [];
    let totalBidsCount = 0;

    if (auctionRoom.currentPlayerId) {
      // Single collect() — used for both display (sliced to 10) and total count.
      // Bid counts per player stay small (typically < 100), so collect() is safe here.
      const allLiveBids = await ctx.db
        .query("liveBids")
        .withIndex("by_player", (q) =>
          q.eq("playerId", auctionRoom.currentPlayerId!),
        )
        .order("desc")
        .collect();

      totalBidsCount = allLiveBids.length;
      const bids = allLiveBids.slice(0, 10);

      if (bids.length > 0) {
        currentBidAmount = bids[0].amount;
        currentBidTeamId = bids[0].teamId;
        const team = await ctx.db.get(bids[0].teamId);
        currentBidTeam = team
          ? { _id: team._id, name: team.name, logoUrl: team.logoUrl, colorPrimary: team.colorPrimary }
          : null;
      }

      recentBids = bids.map((b) => ({
        _id: b._id,
        teamId: b.teamId,
        amount: b.amount,
        timestamp: b.timestamp,
      }));
    }

    // Only the fields clients read: never the unsold queue (~35 bytes per
    // queued player, on every bid, for every viewer) or who created the room.
    const room = {
      _id: auctionRoom._id,
      tournamentId: auctionRoom.tournamentId,
      status: auctionRoom.status,
      currentPlayerId: auctionRoom.currentPlayerId,
      bidTimerEndsAt: auctionRoom.bidTimerEndsAt,
      pausedTimeRemaining: auctionRoom.pausedTimeRemaining,
      auctionPhase: auctionRoom.auctionPhase,
      roundNumber: auctionRoom.roundNumber,
      unsoldRoundTotal: auctionRoom.unsoldRoundTotal,
      unsoldCursor: auctionRoom.unsoldCursor,
      roundStalled: auctionRoom.roundStalled,
      currentSetId: auctionRoom.currentSetId,
      rehearsal: auctionRoom.rehearsal,
    };

    return {
      auctionRoom: room,
      // Latest live-bid amount only (undefined when no bids yet). The client
      // falls back to the current player's base price from `getAuctionRoster`.
      currentBidAmount,
      currentBidTeamId,
      currentBidTeam,
      recentBids,
      totalBidsCount,
      // Server timestamp for client clock-skew correction
      serverTime: Date.now(),
    };
  },
});

/**
 * COLD query — the full roster (teams, sold players, stats, current-player
 * details, squad-completion maxAllowedBid).
 *
 * Intentionally keyed on `tournamentId` + `currentPlayerId` (passed by the
 * client from the hot query) instead of reading the auctionRoom document, so
 * that per-bid / per-timer patches to the room do NOT invalidate this query.
 * It therefore only re-runs — and only re-fans-out to viewers — when a player
 * is actually sold/unsold, a new player starts, or a team purse changes.
 */
export const getAuctionRoster = query({
  args: {
    tournamentId: v.id("tournaments"),
    currentPlayerId: v.optional(v.id("players")),
    // Viewers pass false: the sold list grows with every sale and was most of
    // this payload, re-sent to every viewer twice per player (P1-11). They
    // read it from getSoldPlayers only while a sheet needs it. Counts and
    // per-team numbers are unaffected. Absent = true (console, overlay).
    includeSoldPlayers: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Read only what the fan-out truly needs: teams, the current player, the
    // tournament (which carries denormalized counts), and the SOLD players
    // (needed for the complete screen, squad sheets, and per-team counts).
    // Pending/unsold players are NOT scanned here — their counts and the
    // minimum pending base price come from tournament.auctionCounts, maintained
    // write-side by syncTournamentAuctionCounts. This keeps the query O(sold)
    // instead of O(all players) on every sale fan-out.
    const [currentPlayer, teams, tournament, soldPlayersRaw] =
      await Promise.all([
        args.currentPlayerId ? ctx.db.get(args.currentPlayerId) : null,
        ctx.db
          .query("teams")
          .withIndex("by_tournament", (q) =>
            q.eq("tournamentId", args.tournamentId),
          )
          .collect(),
        ctx.db.get(args.tournamentId),
        ctx.db
          .query("players")
          .withIndex("by_tournament_status", (q) =>
            q
              .eq("tournamentId", args.tournamentId)
              .eq("auctionStatus", "sold"),
          )
          .collect(),
      ]);
    // Deactivated: staff only (identity is read only in this case).
    if (
      tournament?.isActive === false &&
      !(await getTournamentRole(ctx, args.tournamentId))
    ) {
      return null;
    }

    // Captains are pre-assigned and never auctioned — exclude them from every
    // count/list here (mirrors syncTournamentAuctionCounts on the write side).
    const captainPlayerIds = new Set(
      teams.flatMap((t) => (t.captainPlayerId ? [t.captainPlayerId] : [])),
    );

    // Trim sold players to only the fields needed by the client (complete screen + purse map).
    const soldPlayers = soldPlayersRaw
      .filter((p) => !captainPlayerIds.has(p._id))
      .map(toSoldPlayerSummary);

    const maxPlayersPerTeam = tournament?.settings.maxPlayersPerTeam || 15;
    const tournamentSettings = tournament?.settings ?? {};
    const tournamentBasePrice = tournament?.settings.basePrice ?? 100000;
    // Player's own price, else its category's, else the tournament's.
    const currentPlayerBasePrice = currentPlayer
      ? effectiveBasePrice(currentPlayer, tournamentSettings)
      : undefined;

    // Pending/unsold counts + min pending base price from the denormalized
    // counts. Fall back to a live scan for tournaments created before the
    // backfill ran (auctionCounts still undefined).
    let pendingCount: number;
    let unsoldCount: number;
    let minPendingBasePrice: number | undefined;
    const counts = tournament?.auctionCounts;
    if (counts) {
      pendingCount = counts.pending;
      unsoldCount = counts.unsold;
      minPendingBasePrice = counts.minPendingBasePrice;
    } else {
      const [pendingPlayers, unsoldPlayers] = await Promise.all([
        ctx.db
          .query("players")
          .withIndex("by_tournament_status", (q) =>
            q
              .eq("tournamentId", args.tournamentId)
              .eq("auctionStatus", "pending"),
          )
          .collect(),
        ctx.db
          .query("players")
          .withIndex("by_tournament_status", (q) =>
            q
              .eq("tournamentId", args.tournamentId)
              .eq("auctionStatus", "unsold"),
          )
          .collect(),
      ]);
      const pendingNonCaptains = pendingPlayers.filter(
        (p) => !captainPlayerIds.has(p._id),
      );
      pendingCount = pendingNonCaptains.length;
      unsoldCount = unsoldPlayers.filter(
        (p) => !captainPlayerIds.has(p._id),
      ).length;
      minPendingBasePrice =
        pendingNonCaptains.length > 0
          ? Math.min(
              ...pendingNonCaptains.map((p) =>
                effectiveBasePrice(p, tournamentSettings),
              ),
            )
          : undefined;
    }

    // Same reserve price placeBid enforces (bidRules.ts): min pending base
    // price, else the current player's base price, else the tournament default.
    const minBasePrice = reserveBasePrice({
      minPendingBasePrice,
      currentPlayerBasePrice,
      tournamentBasePrice,
    });

    // Build team player counts from soldPlayers already fetched above — avoids N+1 per-team queries
    const teamPlayerCounts = new Map<string, number>();
    for (const p of soldPlayers) {
      if (p.teamId) {
        teamPlayerCounts.set(
          p.teamId,
          (teamPlayerCounts.get(p.teamId) || 0) + 1,
        );
      }
    }

    // Squad rules need each team's players (role + category); group the sold
    // players already loaded above — no extra reads.
    const squadRules = tournament?.settings.squadRules;
    const categories = tournament?.settings.categories;
    const soldByTeam = new Map<string, Doc<"players">[]>();
    if (squadRules?.length) {
      for (const p of soldPlayersRaw) {
        if (!p.teamId || captainPlayerIds.has(p._id)) continue;
        soldByTeam.set(p.teamId, [...(soldByTeam.get(p.teamId) ?? []), p]);
      }
    }

    // Calculate max allowed bids without extra DB queries — same helpers as placeBid
    const teamsWithMaxBid = teams.map((team) => {
      const currentTeamPlayerCount = teamPlayerCounts.get(team._id) || 0;
      const teamSquad = soldByTeam.get(team._id) ?? [];
      const ruleSlots = currentPlayer
        ? minRuleSlots(
            squadRules,
            teamSquad,
            currentPlayer,
            tournament?.auctionCounts?.minPendingBasePriceByRule,
          )
        : [];
      // Same block placeBid returns as its reason (bidCore.loadBidContext).
      const ruleBlock = currentPlayer
        ? (maxRuleViolation(squadRules, categories, teamSquad, currentPlayer) ??
          minRuleShortfall(
            ruleSlots,
            squadRules,
            categories,
            Math.max(0, maxPlayersPerTeam - currentTeamPlayerCount - 1),
          ))
        : null;

      return {
        ...team,
        playerCount: currentTeamPlayerCount,
        playersNeeded: maxPlayersPerTeam - currentTeamPlayerCount,
        isSquadFull: isSquadFull(currentTeamPlayerCount, maxPlayersPerTeam),
        maxAllowedBid: maxAllowedBid({
          purseRemaining: team.purseRemaining,
          playersOnTeam: currentTeamPlayerCount,
          maxPlayersPerTeam,
          reservePrice: minBasePrice,
          minRuleSlots: ruleSlots,
        }),
        ruleBlock,
        // "WK 0/1"-style status for the team card; [] without squad rules.
        ruleStatus: ruleStatus(squadRules, categories, teamSquad),
      };
    });

    return {
      // Always the public projection: this query is shared by every viewer and
      // must stay identity-free, so never branch on the caller's role here.
      // basePrice is resolved (player → category → tournament) so every
      // client shows the price placeBid enforces.
      currentPlayer: currentPlayer
        ? { ...toPublicPlayer(currentPlayer), basePrice: currentPlayerBasePrice }
        : null,
      teams: teamsWithMaxBid,
      // Trimmed projection, not the raw doc — keeps this fan-out payload
      // bounded regardless of what other fields end up on the tournament
      // (e.g. a logo stored inline instead of as a hosted URL).
      tournament: tournament
        ? {
            _id: tournament._id,
            name: tournament.name,
            logoUrl: tournament.logoUrl,
            settings: tournament.settings,
          }
        : null,
      soldPlayers: args.includeSoldPlayers === false ? [] : soldPlayers,
      minBasePrice,
      stats: {
        total:
          pendingCount +
          soldPlayers.length +
          unsoldCount +
          (currentPlayer ? 1 : 0),
        pending: pendingCount,
        sold: soldPlayers.length,
        unsold: unsoldCount,
        inAuction: currentPlayer ? 1 : 0,
      },
    };
  },
});

/** The sold-player fields clients use (squad sheets, complete screen, insights). */
function toSoldPlayerSummary(p: Doc<"players">) {
  return {
    _id: p._id,
    name: p.name,
    role: p.role,
    categoryId: p.categoryId, // owner insights: fair-value bands by category
    soldPrice: p.soldPrice,
    teamId: p.teamId,
  };
}

/**
 * Sold players for the viewer's teams sheet, complete screen and owner
 * insights. Subscribed only while one of those is showing, so it stays out of
 * the always-on viewer payload (P1-11). Identity-free unless the tournament
 * is deactivated.
 */
export const getSoldPlayers = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) return [];
    if (
      tournament.isActive === false &&
      !(await getTournamentRole(ctx, args.tournamentId))
    ) {
      return [];
    }
    const [sold, teams] = await Promise.all([
      ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q.eq("tournamentId", args.tournamentId).eq("auctionStatus", "sold"),
        )
        .collect(),
      ctx.db
        .query("teams")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect(),
    ]);
    const captainIds = new Set(teams.flatMap((t) => (t.captainPlayerId ? [t.captainPlayerId] : [])));
    return sold.filter((p) => !captainIds.has(p._id)).map(toSoldPlayerSummary);
  },
});

/**
 * PER-OWNER paddle state. Reads identity, so each owner gets their own
 * subscription — fine, since there are only a handful of owners per room.
 * Viewers and admins get null and the page skips it for them entirely.
 * Kept separate so getLiveAuction / getAuctionRoster stay identity-free.
 */
export const getMyPaddle = query({
  args: { auctionRoomId: v.id("auctionRooms") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) return null;

    const membership = await findOwnerMembership(
      ctx,
      user._id,
      auctionRoom.tournamentId,
    );
    if (!membership) return null;

    const team = await ctx.db.get(membership.teamId);
    if (!team) return null;

    const bidCtx = await loadBidContext(ctx, auctionRoom, team);
    const { tournament } = bidCtx;
    const playerId = auctionRoom.currentPlayerId;

    // Newest request from my team decides both "pending" and the last outcome.
    const [myPending, newest] = await Promise.all([
      playerId
        ? pendingRequestsFor(ctx, auctionRoom._id, playerId).then(
            (rs) => rs.find((r) => r.teamId === team._id) ?? null,
          )
        : null,
      ctx.db
        .query("bidRequests")
        .withIndex("by_team", (q) => q.eq("teamId", team._id))
        .order("desc")
        .first(),
    ]);
    const lastResolved =
      newest && newest.status !== "pending" && newest.playerId === playerId
        ? newest
        : null;

    return {
      bidMode: tournament.settings.bidMode ?? "admin_only",
      team: {
        _id: team._id,
        name: team.name,
        logoUrl: team.logoUrl,
        colorPrimary: team.colorPrimary,
      },
      purseRemaining: team.purseRemaining,
      playersNeeded: Math.max(
        0,
        tournament.settings.maxPlayersPerTeam - bidCtx.teamPlayers.length,
      ),
      maxAllowedBid: bidCtx.allowedMax,
      // Squad rule stopping this team from taking the current player, if any.
      ruleBlock: bidCtx.squadRuleBlock,
      minNextBid: bidCtx.minNextBid,
      currentBid: bidCtx.latestBid?.amount ?? null,
      minBidIncrement: tournament.settings.minBidIncrement,
      incrementSlabs: tournament.settings.incrementSlabs ?? [],
      isLeading: bidCtx.latestBid?.teamId === team._id,
      currentPlayerId: playerId ?? null,
      myPending: myPending
        ? {
            _id: myPending._id,
            amount: myPending.amount,
            createdAt: myPending.createdAt,
          }
        : null,
      lastResolved: lastResolved
        ? {
            _id: lastResolved._id,
            status: lastResolved.status,
            reason: lastResolved.reason,
            amount: lastResolved.amount,
          }
        : null,
    };
  },
});

/**
 * ADMIN-ONLY incoming-raises tray: the current player's pending owner raises,
 * newest first, plus the minimum valid next bid so the console can highlight
 * the newest raise that would still be accepted.
 */
export const getPendingBidRequests = query({
  args: { auctionRoomId: v.id("auctionRooms") },
  handler: async (ctx, args) => {
    const empty = { requests: [], minNextBid: null };
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) return empty;
    // The tournament's console staff only (any other caller sees an empty tray).
    if (!(await getTournamentRole(ctx, auctionRoom.tournamentId))) return empty;
    const playerId = auctionRoom.currentPlayerId;
    if (!playerId) return empty;

    const [pending, player, tournament, latestBid] = await Promise.all([
      pendingRequestsFor(ctx, auctionRoom._id, playerId),
      ctx.db.get(playerId),
      ctx.db.get(auctionRoom.tournamentId),
      latestLiveBid(ctx, playerId),
    ]);
    if (!player || !tournament) return empty;

    const teams = new Map(
      (
        await Promise.all(
          [...new Set(pending.map((r) => r.teamId))].map((id) =>
            ctx.db.get(id),
          ),
        )
      ).flatMap((t) => (t ? [[t._id, t] as const] : [])),
    );

    return {
      requests: pending.map((r) => ({
        _id: r._id,
        teamId: r.teamId,
        teamName: teams.get(r.teamId)?.name ?? "Unknown team",
        logoUrl: teams.get(r.teamId)?.logoUrl,
        colorPrimary: teams.get(r.teamId)?.colorPrimary ?? "#64748b",
        amount: r.amount,
        createdAt: r.createdAt,
      })),
      minNextBid: minNextBidFor(
        latestBid,
        playerBasePriceFor(player, tournament),
        tournament,
      ),
    };
  },
});

/**
 * Latest SOLD / UNSOLD event for a room — the authoritative source for the
 * viewer result popup. Viewers show the popup when a new event id appears,
 * instead of reconstructing the result from client-side ref timing across the
 * separately-updating hot/cold queries (which was racy). Enriched with the
 * player photo and winning-team logo/color, which the raw event does not store.
 *
 * Only re-fans-out when a new sale event is written (or the tournament base
 * price / player photo changes), NOT on every bid — the finalization events are
 * infrequent, so the extra document reads here are cheap.
 */
export const getLatestSaleEvent = query({
  args: { auctionRoomId: v.id("auctionRooms") },
  handler: async (ctx, args) => {
    // Scan a small recent window and pick the newest sold/unsold event. Between
    // two sales there are only a handful of intervening events (player_started,
    // pause/resume, restart), so a bounded window reliably contains the latest.
    const recentEvents = await ctx.db
      .query("auctionEvents")
      .withIndex("by_room_timestamp", (q) =>
        q.eq("auctionRoomId", args.auctionRoomId),
      )
      .order("desc")
      .take(25);

    const sale = recentEvents.find(
      (e) => e.type === "player_sold" || e.type === "player_unsold",
    );
    if (!sale) return null;

    const data = sale.data as {
      playerId?: string;
      teamId?: string;
      amount?: number;
      basePrice?: number;
      playerName?: string;
      teamName?: string;
    };
    const sold = sale.type === "player_sold";

    // Enrich with photo / team branding not stored on the event.
    const player = data.playerId
      ? await ctx.db.get(data.playerId as Id<"players">)
      : null;
    // Hidden check through the player's tournament, never the room doc
    // (which changes on every bid).
    const tournament = player ? await ctx.db.get(player.tournamentId) : null;
    if (
      tournament?.isActive === false &&
      !(await getTournamentRole(ctx, tournament._id))
    ) {
      return null;
    }
    const team =
      sold && data.teamId ? await ctx.db.get(data.teamId as Id<"teams">) : null;

    // Unsold events carry the resolved base price in `data.basePrice` (written by
    // finalizePlayerSale / markPlayerFinalUnsold). Reading it here — instead of
    // the auctionRoom doc — keeps this query OUT of the per-bid room-patch
    // invalidation set, so it no longer re-fans to every viewer on each bid
    // after an unsold result. (P1-2). Fallbacks cover legacy events.
    let amount = data.amount ?? 0;
    if (!sold) {
      amount = data.basePrice ?? player?.basePrice ?? 100000;
    }

    return {
      eventId: sale._id,
      timestamp: sale.timestamp,
      sold,
      playerName: data.playerName ?? player?.name ?? "Player",
      playerPhotoUrl: player?.photoUrl,
      teamName: sold ? (data.teamName ?? team?.name ?? null) : null,
      teamLogoUrl: team?.logoUrl,
      teamColor: team?.colorPrimary,
      amount,
    };
  },
});

/**
 * SOLD + UNSOLD history for the viewer history sheets. Intended to be
 * subscribed lazily (only while a history sheet is open) so it stays out of the
 * always-on hot/cold payload. Sold entries are enriched with the winning team's
 * name/color/logo and sorted by price (highest first).
 */
export const getAuctionHistory = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    // Query sold/unsold directly via the by_tournament_status compound index so
    // we never read pending / in-auction players (cheaper for large rosters).
    const [soldPlayers, unsoldPlayers, teams, tournament] = await Promise.all([
      ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q.eq("tournamentId", args.tournamentId).eq("auctionStatus", "sold"),
        )
        .collect(),
      ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q.eq("tournamentId", args.tournamentId).eq("auctionStatus", "unsold"),
        )
        .collect(),
      ctx.db
        .query("teams")
        .withIndex("by_tournament", (q) =>
          q.eq("tournamentId", args.tournamentId),
        )
        .collect(),
      ctx.db.get(args.tournamentId),
    ]);

    if (
      tournament?.isActive === false &&
      !(await getTournamentRole(ctx, args.tournamentId))
    ) {
      return { sold: [], unsold: [] };
    }

    const teamMap = new Map(teams.map((t) => [t._id, t]));
    const tournamentSettings = tournament?.settings ?? {};

    // Captains are never auctioned — keep them out of sold/unsold history.
    const captainPlayerIds = new Set(
      teams.flatMap((t) => (t.captainPlayerId ? [t.captainPlayerId] : [])),
    );

    const sold = soldPlayers
      .filter((p) => !captainPlayerIds.has(p._id))
      .map((p) => {
        const team = p.teamId ? teamMap.get(p.teamId) : undefined;
        return {
          _id: p._id,
          name: p.name,
          role: p.role,
          photoUrl: p.photoUrl,
          soldPrice: p.soldPrice ?? 0,
          teamId: p.teamId,
          teamName: team?.name ?? null,
          teamColor: team?.colorPrimary,
          teamLogoUrl: team?.logoUrl,
        };
      })
      .sort((a, b) => b.soldPrice - a.soldPrice);

    // basePrice can be undefined on the player (inherited from its category or
    // the tournament), so resolve it the same way placeBid does.
    const unsold = unsoldPlayers
      .filter((p) => !captainPlayerIds.has(p._id))
      .map((p) => ({
        _id: p._id,
        name: p.name,
        role: p.role,
        photoUrl: p.photoUrl,
        basePrice: effectiveBasePrice(p, tournamentSettings),
      }));

    return { sold, unsold };
  },
});

// Get auction rooms for a tournament
/**
 * ADMIN-ONLY reconciliation — proves every purse and status count is correct.
 *
 * For each team: purseSpent must equal the sum of its sold players' soldPrice,
 * and purseRemaining + purseSpent must equal settings.basePurse plus the
 * team's purseAdjustment. Player counts
 * per status must match the denormalized tournament.auctionCounts.
 *
 * Reads only the tournament, its teams and its players — never the auction
 * room or liveBids — so it does not re-run on bids. Subscribed only by the
 * admin console; NOT part of the viewer hot path, so reading identity is fine.
 */
export const getReconciliation = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireTournamentRole(ctx, args.tournamentId, RUN_AUCTION);

    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const [teams, players] = await Promise.all([
      ctx.db
        .query("teams")
        .withIndex("by_tournament", (q) =>
          q.eq("tournamentId", args.tournamentId),
        )
        .collect(),
      ctx.db
        .query("players")
        .withIndex("by_tournament", (q) =>
          q.eq("tournamentId", args.tournamentId),
        )
        .collect(),
    ]);

    const issues: Array<{
      kind: "purse_spent" | "purse_total" | "orphan_sale" | "status_counts";
      teamId?: Id<"teams">;
      playerId?: Id<"players">;
      message: string;
    }> = [];

    const basePurse = tournament.settings.basePurse;
    const soldTotals = new Map<Id<"teams">, number>();
    const teamIds = new Set(teams.map((t) => t._id));

    for (const p of players) {
      if (p.auctionStatus !== "sold") continue;
      if (!p.teamId || !teamIds.has(p.teamId)) {
        issues.push({
          kind: "orphan_sale",
          playerId: p._id,
          message: `${p.name} is marked sold but has no team in this tournament`,
        });
        continue;
      }
      soldTotals.set(p.teamId, (soldTotals.get(p.teamId) ?? 0) + (p.soldPrice ?? 0));
    }

    for (const team of teams) {
      const sold = soldTotals.get(team._id) ?? 0;
      if (team.purseSpent !== sold) {
        issues.push({
          kind: "purse_spent",
          teamId: team._id,
          message: `${team.name}: spent ₹${team.purseSpent} but sold players total ₹${sold}`,
        });
      }
      const purseTotal = teamPurseTotal(basePurse, team);
      if (team.purseRemaining + team.purseSpent !== purseTotal) {
        issues.push({
          kind: "purse_total",
          teamId: team._id,
          message: team.purseAdjustment
            ? `${team.name}: remaining ₹${team.purseRemaining} + spent ₹${team.purseSpent} ≠ base purse ₹${basePurse} + adjustments ₹${team.purseAdjustment}`
            : `${team.name}: remaining ₹${team.purseRemaining} + spent ₹${team.purseSpent} ≠ base purse ₹${basePurse}`,
        });
      }
    }

    const expected = computeAuctionCounts(players, teams, tournament.settings);
    if (!auctionCountsEqual(tournament.auctionCounts, expected)) {
      const stored = tournament.auctionCounts;
      issues.push({
        kind: "status_counts",
        message: stored
          ? `Stored counts (pending ${stored.pending}, sold ${stored.sold}, unsold ${stored.unsold}, on block ${stored.inAuction}) differ from players (pending ${expected.pending}, sold ${expected.sold}, unsold ${expected.unsold}, on block ${expected.inAuction})`
          : "Status counts have not been computed for this tournament",
      });
    }

    return { ok: issues.length === 0, issues };
  },
});

export const getAuctionRooms = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (
      tournament?.isActive === false &&
      !(await getTournamentRole(ctx, args.tournamentId))
    ) {
      return [];
    }
    return await ctx.db
      .query("auctionRooms")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();
  },
});

/**
 * Restart auction - reset all players, teams, and auction state (owners only).
 * Never while the room is live (pause first), only with the tournament name
 * typed, and always after a snapshot of everything it is about to wipe
 * (AUDIT 2026-10 P0-3).
 */
export const restartAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
    confirmName: v.string(),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");
    const admin = await requireTournamentRole(ctx, auctionRoom.tournamentId, OWNER_ONLY);

    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    if (auctionRoom.status === "live") {
      throw new Error("Pause the auction before restarting it");
    }
    if (!confirmsTournamentName(args.confirmName, tournament.name)) {
      throw new Error(`Type the tournament name (${tournament.name}) to confirm the restart`);
    }
    const snapshotId = await takeSnapshot(
      ctx,
      auctionRoom.tournamentId,
      "before restart_auction",
      admin._id,
    );

    const now = Date.now();
    const basePurse = tournament.settings.basePurse;

    // Get all related data
    const [players, teams, liveBids, bids, events] = await Promise.all([
      ctx.db
        .query("players")
        .withIndex("by_tournament", (q) =>
          q.eq("tournamentId", auctionRoom.tournamentId),
        )
        .collect(),
      ctx.db
        .query("teams")
        .withIndex("by_tournament", (q) =>
          q.eq("tournamentId", auctionRoom.tournamentId),
        )
        .collect(),
      ctx.db
        .query("liveBids")
        .withIndex("by_room", (q) => q.eq("auctionRoomId", args.auctionRoomId))
        .collect(),
      ctx.db
        .query("bids")
        .withIndex("by_auction_room", (q) =>
          q.eq("auctionRoomId", args.auctionRoomId),
        )
        .collect(),
      ctx.db
        .query("auctionEvents")
        .withIndex("by_auction_room", (q) =>
          q.eq("auctionRoomId", args.auctionRoomId),
        )
        .collect(),
    ]);

    // Helper: execute thunks in sequential chunks to stay within Convex's
    // per-mutation write limit (~1000 ops). Accepts thunks so that DB writes
    // are only initiated for the current chunk, not all at once upfront.
    async function runInChunks<T>(
      thunks: (() => Promise<T>)[],
      chunkSize = 200,
    ): Promise<void> {
      for (let i = 0; i < thunks.length; i += chunkSize) {
        await Promise.all(thunks.slice(i, i + chunkSize).map((fn) => fn()));
      }
    }

    // Reset the room and tournament first (fast, always-two ops).
    await Promise.all([
      ctx.db.patch(args.auctionRoomId, {
        status: "waiting",
        currentPlayerId: undefined,
        bidTimerEndsAt: undefined,
        pausedTimeRemaining: undefined,
        auctionPhase: "main",
        roundNumber: 1,
        unsoldRoundTotal: undefined,
        unsoldQueue: undefined,
        unsoldCursor: undefined,
        roundStalled: undefined,
        currentSetId: undefined,
        updatedAt: now,
      }),
      ctx.db.patch(auctionRoom.tournamentId, {
        status: "active",
        updatedAt: now,
      }),
    ]);

    // Reset players, teams, and delete records in bounded batches.
    await runInChunks(
      players.map(
        (player) => () =>
          ctx.db.patch(player._id, {
            auctionStatus: "pending",
            soldPrice: undefined,
            teamId: undefined,
            updatedAt: now,
          }),
      ),
    );

    await runInChunks(
      teams.map(
        (team) => () =>
          ctx.db.patch(team._id, {
            // Admin adjustments (penalties, top-ups) are kept across a restart.
            purseRemaining: teamPurseTotal(basePurse, team),
            purseSpent: 0,
            updatedAt: now,
          }),
      ),
    );

    await runInChunks([
      ...liveBids.map((bid) => () => ctx.db.delete(bid._id)),
      ...bids.map((bid) => () => ctx.db.delete(bid._id)),
      ...events.map((event) => () => ctx.db.delete(event._id)),
    ]);

    // All players are back to "pending" — recompute counts from scratch.
    await syncTournamentAuctionCounts(ctx, auctionRoom.tournamentId);

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "restart_auction",
      targetType: "auction",
      targetId: args.auctionRoomId,
      previousData: {
        status: auctionRoom.status,
        soldPlayers: players.filter((p) => p.auctionStatus === "sold").length,
        teamPurses: teams.map((t) => ({
          teamId: t._id,
          purseRemaining: t.purseRemaining,
          purseSpent: t.purseSpent,
        })),
      },
      newData: { snapshotId },
      tournamentId: auctionRoom.tournamentId,
      auctionRoomId: args.auctionRoomId,
    });

    return { success: true, message: "Auction has been reset" };
  },
});
