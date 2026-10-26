// convex/auctions.ts - Live auction mutations and queries
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id, Doc } from "./_generated/dataModel";
import { requireAdmin, logAdminAction } from "./auth";
import {
  auctionCountsEqual,
  computeAuctionCounts,
  syncTournamentAuctionCounts,
} from "./auctionCounts";
import { toPublicPlayer } from "./projections";
import {
  DEFAULT_BASE_PRICE,
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
    const user = await requireAdmin(ctx);

    const existing = await ctx.db
      .query("auctionRooms")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .first();
    if (existing) {
      throw new Error("An auction room already exists for this tournament");
    }

    const auctionRoomId = await ctx.db.insert("auctionRooms", {
      tournamentId: args.tournamentId,
      name: args.name,
      status: "waiting",
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
    await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status === "live") {
      return { success: true, message: "Auction already live" };
    }

    if (auctionRoom.status === "completed") {
      throw new Error("Auction has already completed");
    }

    const now = Date.now();
    await Promise.all([
      ctx.db.patch(args.auctionRoomId, {
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
      ctx.db.patch(auctionRoom.tournamentId, {
        status: "active",
        updatedAt: now,
      }),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "auction_started",
        data: {},
        timestamp: now,
      }),
    ]);

    return { success: true };
  },
});

/** Pause the auction — captures remaining timer so resume can restore it. */
export const pauseAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

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
    const admin = await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

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
      : (tournament.settings.bidTimerSeconds || 30) * 1000;

    const updates: Record<string, unknown> = {
      status: "live",
      pausedTimeRemaining: undefined,
      updatedAt: now,
    };

    if (auctionRoom.currentPlayerId) {
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
  },
  handler: async (ctx, args) => {
    // Only admins can place bids
    await requireAdmin(ctx);

    if (args.amount <= 0) {
      return { success: false, reason: "Bid amount must be positive" };
    }

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status !== "live") {
      return { success: false, reason: "Auction is not live" };
    }

    if (!auctionRoom.currentPlayerId) {
      return { success: false, reason: "No player currently in auction" };
    }

    // NOTE: No server-side timer-expiry guard. This auction is auctioneer-paced —
    // a human calls each bid and finalizes manually — so a legitimately-called
    // bid that lands after `bidTimerEndsAt` (e.g. a long player introduction or a
    // mid-bidding lull) must still be accepted. `bidTimerEndsAt` is a UI countdown
    // only; it must never silently drop a real bid. (See AUDIT.md P0-1.)

    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found");

    if (team.tournamentId !== auctionRoom.tournamentId) {
      return {
        success: false,
        reason: "Team is not part of this auction's tournament",
      };
    }

    const [player, tournament, teamPlayers] = await Promise.all([
      ctx.db.get(auctionRoom.currentPlayerId),
      ctx.db.get(auctionRoom.tournamentId),
      ctx.db
        .query("players")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .collect(),
    ]);

    if (!player) throw new Error("Player not found");
    if (!tournament) throw new Error("Tournament not found");

    const maxPlayersPerTeam = tournament.settings.maxPlayersPerTeam;
    if (isSquadFull(teamPlayers.length, maxPlayersPerTeam)) {
      return { success: false, reason: "Squad is full" };
    }

    if (team.purseRemaining < args.amount) {
      return { success: false, reason: "Insufficient purse balance" };
    }

    // Squad-completion reserve — same rule getAuctionRoster displays (bidRules.ts).
    // minPendingBasePrice comes from the denormalized tournament.auctionCounts,
    // so no pending-player scan on this hot path.
    const tournamentBasePrice = tournament.settings.basePrice ?? DEFAULT_BASE_PRICE;
    const playerBasePrice = player.basePrice ?? tournamentBasePrice;
    const allowedMax = maxAllowedBid({
      purseRemaining: team.purseRemaining,
      playersOnTeam: teamPlayers.length,
      maxPlayersPerTeam,
      reservePrice: reserveBasePrice({
        minPendingBasePrice: tournament.auctionCounts?.minPendingBasePrice,
        currentPlayerBasePrice: playerBasePrice,
        tournamentBasePrice,
      }),
    });

    if (args.amount > allowedMax) {
      return {
        success: false,
        reason: `Cannot bid this amount. Insufficient purse to complete squad. Max allowed: ₹${(allowedMax / 100000).toFixed(2)}L`,
        maxAllowedBid: allowedMax,
      };
    }

    // Get latest bid using index (NO .collect())
    const latestBid = await ctx.db
      .query("liveBids")
      .withIndex("by_player", (q) =>
        q.eq("playerId", auctionRoom.currentPlayerId!),
      )
      .order("desc")
      .first();

    // Bid rate limiting: reject if same team bid < 500ms ago (prevents spam)
    if (
      latestBid &&
      latestBid.teamId === args.teamId &&
      Date.now() - latestBid.timestamp < 500
    ) {
      return { success: false, reason: "Please wait before bidding again" };
    }

    const currentBid = latestBid?.amount || playerBasePrice;
    const minBidIncrement = tournament.settings.minBidIncrement;

    if (!latestBid) {
      if (args.amount < playerBasePrice) {
        return {
          success: false,
          reason: "First bid must be at least base price",
        };
      }
    } else {
      if (args.amount < currentBid + minBidIncrement) {
        return {
          success: false,
          reason: "Minimum bid is " + (currentBid + minBidIncrement),
        };
      }
    }

    const now = Date.now();
    const bidTimerSeconds = tournament.settings.bidTimerSeconds || 30;

    // Insert bid AND reset timer on every bid.
    // Note: per-bid audit logging is intentionally omitted here — placeBid is
    // a high-frequency hot path and logging every bid would cause write
    // amplification and rapid auditLogs growth. The full bid history is
    // already captured in the liveBids table and archived to bids on
    // finalization, which is sufficient for auditing.
    await Promise.all([
      ctx.db.insert("liveBids", {
        auctionRoomId: args.auctionRoomId,
        playerId: auctionRoom.currentPlayerId,
        teamId: args.teamId,
        amount: args.amount,
        timestamp: now,
      }),
      // Reset timer on every bid
      ctx.db.patch(args.auctionRoomId, {
        bidTimerEndsAt: now + bidTimerSeconds * 1000,
        updatedAt: now,
      }),
    ]);

    return { success: true, amount: args.amount, teamId: args.teamId };
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
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

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

    const player = await ctx.db.get(currentPlayerId);
    if (!player) throw new Error("Player not found");

    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const playerBasePrice =
      player.basePrice ?? tournament.settings.basePrice ?? 100000;

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
          },
          timestamp: now,
        }),
        ...allLiveBids.map((bid) => ctx.db.delete(bid._id)),
      ]);

      // Best-effort WhatsApp notification to the sold player. Scheduled AFTER
      // the sale is committed so a messaging failure can never roll back the
      // sale. No-ops gracefully if the player has no phone or Twilio is unset.
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.sendPlayerSoldWhatsApp,
        {
          playerName: player.name,
          phoneNumber: player.phoneNumber,
          tournamentName: tournament.name,
          teamName: team.name,
          ownerName: team.ownerName,
          captainName: team.captainName,
          soldPrice: winningBid.amount,
        },
      );
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
  },
});

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
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status !== "live") {
      return { success: false, reason: "Auction is not live" };
    }

    const currentPlayerId = auctionRoom.currentPlayerId;
    if (!currentPlayerId) {
      return { success: false, reason: "No player in auction" };
    }

    const player = await ctx.db.get(currentPlayerId);
    if (!player) throw new Error("Player not found");

    // Resolve the effective base price now so it can be stored on the event
    // (lets getLatestSaleEvent avoid a per-bid room read — P1-2).
    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    const playerBasePrice =
      player.basePrice ?? tournament?.settings.basePrice ?? 100000;

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
    const admin = await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

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

    const bidTimerSeconds = tournament.settings.bidTimerSeconds || 30;

    // Put a player into the auction ring and broadcast it. `roomPatch` carries
    // the round bookkeeping (phase / roundNumber / queue cursor) for this case.
    const presentPlayer = async (
      player: Doc<"players">,
      roomPatch: RoomRoundPatch,
    ) => {
      const now = Date.now();
      const basePrice =
        player.basePrice ?? tournament.settings.basePrice ?? 100000;
      await Promise.all([
        ctx.db.patch(player._id, {
          auctionStatus: "in_auction",
          updatedAt: now,
        }),
        ctx.db.patch(args.auctionRoomId, {
          currentPlayerId: player._id,
          bidTimerEndsAt: now + bidTimerSeconds * 1000,
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
      ]);
      return { success: true, completed: true };
    };

    // ── Main round: dynamic random pick from the pending pool ────────────────
    if (pendingPlayers.length > 0) {
      const nextPlayer =
        pendingPlayers[Math.floor(Math.random() * pendingPlayers.length)];
      return await presentPlayer(nextPlayer, {
        auctionPhase: "main",
        roundNumber: 1,
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
    const admin = await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");
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

    if (args.action === "end") {
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
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

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

    if (!latestBid) {
      throw new Error("No bids to revert");
    }

    await ctx.db.delete(latestBid._id);

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

    return { success: true };
  },
});

/**
 * Restart bidding for the current player — clears ALL live bids and resets the
 * timer to the tournament default. The player remains in_auction.
 */
export const restartCurrentPlayer = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (!auctionRoom.currentPlayerId) {
      throw new Error("No player currently in auction");
    }

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
    const bidTimerSeconds = tournament.settings.bidTimerSeconds || 30;

    // Delete bids in bounded chunks (consistent with other mutations in this file).
    const CHUNK = 200;
    for (let i = 0; i < allBids.length; i += CHUNK) {
      await Promise.all(
        allBids.slice(i, i + CHUNK).map((bid) => ctx.db.delete(bid._id)),
      );
    }

    // Reset the timer and record the event once all deletes are done.
    await Promise.all([
      ctx.db.patch(args.auctionRoomId, {
        bidTimerEndsAt: now + bidTimerSeconds * 1000,
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

    return { success: true };
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

    let currentBidTeam = null;
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
        currentBidTeam = await ctx.db.get(bids[0].teamId);
      }

      recentBids = bids.map((b) => ({
        _id: b._id,
        teamId: b.teamId,
        amount: b.amount,
        timestamp: b.timestamp,
      }));
    }

    return {
      auctionRoom,
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

    // Captains are pre-assigned and never auctioned — exclude them from every
    // count/list here (mirrors syncTournamentAuctionCounts on the write side).
    const captainPlayerIds = new Set(
      teams.flatMap((t) => (t.captainPlayerId ? [t.captainPlayerId] : [])),
    );

    // Trim sold players to only the fields needed by the client (complete screen + purse map).
    const soldPlayers = soldPlayersRaw
      .filter((p) => !captainPlayerIds.has(p._id))
      .map((p) => ({
        _id: p._id,
        name: p.name,
        role: p.role,
        soldPrice: p.soldPrice,
        teamId: p.teamId,
      }));

    const maxPlayersPerTeam = tournament?.settings.maxPlayersPerTeam || 15;
    const tournamentBasePrice = tournament?.settings.basePrice ?? 100000;

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
              ...pendingNonCaptains.map(
                (p) => p.basePrice ?? tournamentBasePrice,
              ),
            )
          : undefined;
    }

    // Same reserve price placeBid enforces (bidRules.ts): min pending base
    // price, else the current player's base price, else the tournament default.
    const minBasePrice = reserveBasePrice({
      minPendingBasePrice,
      currentPlayerBasePrice: currentPlayer
        ? (currentPlayer.basePrice ?? tournamentBasePrice)
        : undefined,
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

    // Calculate max allowed bids without extra DB queries — same helpers as placeBid
    const teamsWithMaxBid = teams.map((team) => {
      const currentTeamPlayerCount = teamPlayerCounts.get(team._id) || 0;

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
        }),
      };
    });

    return {
      // Always the public projection: this query is shared by every viewer and
      // must stay identity-free, so never branch on the caller's role here.
      currentPlayer: currentPlayer ? toPublicPlayer(currentPlayer) : null,
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
      soldPlayers,
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

    const teamMap = new Map(teams.map((t) => [t._id, t]));
    const tournamentBasePrice = tournament?.settings.basePrice ?? 100000;

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

    // basePrice can be undefined on the player (inherited from tournament),
    // so fall back to the tournament default the same way the rest of the app does.
    const unsold = unsoldPlayers
      .filter((p) => !captainPlayerIds.has(p._id))
      .map((p) => ({
        _id: p._id,
        name: p.name,
        role: p.role,
        photoUrl: p.photoUrl,
        basePrice: p.basePrice ?? tournamentBasePrice,
      }));

    return { sold, unsold };
  },
});

// Get auction rooms for a tournament
/**
 * ADMIN-ONLY reconciliation — proves every purse and status count is correct.
 *
 * For each team: purseSpent must equal the sum of its sold players' soldPrice,
 * and purseRemaining + purseSpent must equal settings.basePurse. Player counts
 * per status must match the denormalized tournament.auctionCounts.
 *
 * Reads only the tournament, its teams and its players — never the auction
 * room or liveBids — so it does not re-run on bids. Subscribed only by the
 * admin console; NOT part of the viewer hot path, so reading identity is fine.
 */
export const getReconciliation = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

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
      if (team.purseRemaining + team.purseSpent !== basePurse) {
        issues.push({
          kind: "purse_total",
          teamId: team._id,
          message: `${team.name}: remaining ₹${team.purseRemaining} + spent ₹${team.purseSpent} ≠ base purse ₹${basePurse}`,
        });
      }
    }

    const expected = computeAuctionCounts(
      players,
      teams,
      tournament.settings.basePrice ?? DEFAULT_BASE_PRICE,
    );
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
    return await ctx.db
      .query("auctionRooms")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();
  },
});

// Check if auction is active (live or paused) for a tournament
export const isAuctionActive = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const auctionRooms = await ctx.db
      .query("auctionRooms")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();

    // Check if any auction room is live or paused
    const activeRoom = auctionRooms.find(
      (room) => room.status === "live" || room.status === "paused",
    );

    return {
      isActive: !!activeRoom,
      status: activeRoom?.status || null,
      auctionRoomId: activeRoom?._id || null,
    };
  },
});

// Restart auction - reset all players, teams, and auction state (Admin only)
export const restartAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

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
            purseRemaining: basePurse,
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
      tournamentId: auctionRoom.tournamentId,
      auctionRoomId: args.auctionRoomId,
    });

    return { success: true, message: "Auction has been reset" };
  },
});
