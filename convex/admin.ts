// convex/admin.ts - Admin-only mutations for managing auction data
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, logAdminAction } from "./auth";
import { syncTournamentAuctionCounts } from "./auctionCounts";
import {
  DEFAULT_BASE_PRICE,
  isSquadFull,
  maxAllowedBid,
  reserveBasePrice,
} from "./bidRules";
import type { Doc } from "./_generated/dataModel";

// Helper: format purse amount for error messages
function formatPurse(amount: number): string {
  return `₹${(amount / 100000).toFixed(2)}L`;
}

/**
 * Squad-completion check shared by the admin corrections — the same rule
 * placeBid enforces (bidRules.ts). `playersOnTeam` and `purseRemaining` are the
 * team's state WITHOUT the player being priced. Throws a readable error if
 * `price` would leave the team unable to fill its squad.
 */
function assertCanAffordPlayer(
  tournament: Doc<"tournaments"> | null,
  args: { purseRemaining: number; playersOnTeam: number; price: number },
) {
  const maxPlayersPerTeam = tournament?.settings?.maxPlayersPerTeam || 15;
  if (isSquadFull(args.playersOnTeam, maxPlayersPerTeam)) {
    throw new Error(
      `This team's squad is full (${maxPlayersPerTeam} players).`,
    );
  }
  const reservePrice = reserveBasePrice({
    minPendingBasePrice: tournament?.auctionCounts?.minPendingBasePrice,
    currentPlayerBasePrice: undefined,
    tournamentBasePrice: tournament?.settings?.basePrice ?? DEFAULT_BASE_PRICE,
  });
  const allowedMax = maxAllowedBid({
    purseRemaining: args.purseRemaining,
    playersOnTeam: args.playersOnTeam,
    maxPlayersPerTeam,
    reservePrice,
  });
  if (args.price > allowedMax) {
    const slotsAfter = maxPlayersPerTeam - args.playersOnTeam - 1;
    throw new Error(
      `This would leave the team unable to fill their squad. They'd have ${formatPurse(args.purseRemaining - args.price)} remaining but need ${formatPurse(slotsAfter * reservePrice)} to fill ${slotsAfter} more slot(s) at base price. Max allowed: ${formatPurse(allowedMax)}.`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYER MANAGEMENT - Admin can modify ANY player data during live auction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reassign a sold player to a different team
 * - Updates player's teamId
 * - Adjusts purse balances for both teams
 * - Optionally adjust sold price
 */
export const reassignPlayer = mutation({
  args: {
    playerId: v.id("players"),
    newTeamId: v.id("teams"),
    newSoldPrice: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const player = await ctx.db.get(args.playerId);
    if (!player) throw new Error("Player not found");

    const newTeam = await ctx.db.get(args.newTeamId);
    if (!newTeam) throw new Error("New team not found");

    const oldTeamId = player.teamId;
    const oldSoldPrice = player.soldPrice || 0;
    const newSoldPrice = args.newSoldPrice ?? oldSoldPrice;

    // Get old team if exists
    const oldTeam = oldTeamId ? await ctx.db.get(oldTeamId) : null;

    // Refund old team's purse if player was previously sold
    if (oldTeam && oldSoldPrice > 0) {
      await ctx.db.patch(oldTeam._id, {
        purseRemaining: oldTeam.purseRemaining + oldSoldPrice,
        purseSpent: oldTeam.purseSpent - oldSoldPrice,
        updatedAt: Date.now(),
      });
    }

    // Deduct from new team's purse
    if (newSoldPrice > newTeam.purseRemaining) {
      throw new Error(
        `New team has insufficient purse. Available: ₹${newTeam.purseRemaining}, Required: ₹${newSoldPrice}`,
      );
    }

    // Squad completion check: after this reassignment, can the new team still fill remaining slots?
    const tournament = await ctx.db.get(player.tournamentId);
    const newTeamCurrentPlayers = await ctx.db
      .query("players")
      .withIndex("by_team", (q) => q.eq("teamId", args.newTeamId))
      .collect();
    assertCanAffordPlayer(tournament, {
      purseRemaining: newTeam.purseRemaining,
      playersOnTeam: newTeamCurrentPlayers.filter(
        (p) => p._id !== args.playerId,
      ).length,
      price: newSoldPrice,
    });

    await ctx.db.patch(args.newTeamId, {
      purseRemaining: newTeam.purseRemaining - newSoldPrice,
      purseSpent: newTeam.purseSpent + newSoldPrice,
      updatedAt: Date.now(),
    });

    // Update player
    await ctx.db.patch(args.playerId, {
      teamId: args.newTeamId,
      soldPrice: newSoldPrice,
      auctionStatus: "sold",
      updatedAt: Date.now(),
    });

    // Log the action
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "reassign_player",
      targetType: "player",
      targetId: args.playerId,
      previousData: {
        teamId: oldTeamId,
        soldPrice: oldSoldPrice,
        teamName: oldTeam?.name,
      },
      newData: {
        teamId: args.newTeamId,
        soldPrice: newSoldPrice,
        teamName: newTeam.name,
        reason: args.reason,
      },
      tournamentId: player.tournamentId,
    });

    return { success: true, message: "Player reassigned successfully" };
  },
});

/**
 * Update sold price for a player
 * - Adjusts team's purse balance accordingly
 */
export const updateSoldPrice = mutation({
  args: {
    playerId: v.id("players"),
    newSoldPrice: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const player = await ctx.db.get(args.playerId);
    if (!player) throw new Error("Player not found");

    if (player.auctionStatus !== "sold" || !player.teamId) {
      throw new Error("Player is not sold to any team");
    }

    const team = await ctx.db.get(player.teamId);
    if (!team) throw new Error("Team not found");

    const oldSoldPrice = player.soldPrice || 0;
    const priceDifference = args.newSoldPrice - oldSoldPrice;

    // Check if team has enough purse for price increase
    if (priceDifference > 0 && priceDifference > team.purseRemaining) {
      throw new Error(
        `Team has insufficient purse for price increase. Available: ₹${team.purseRemaining}`,
      );
    }

    // Squad completion check: after price change, can team still fill remaining slots?
    const tournament = await ctx.db.get(player.tournamentId);
    const teamCurrentPlayers = await ctx.db
      .query("players")
      .withIndex("by_team", (q) => q.eq("teamId", team._id))
      .collect();
    // Price the player as if re-bought: refund their old price, exclude them from the count.
    assertCanAffordPlayer(tournament, {
      purseRemaining: team.purseRemaining + oldSoldPrice,
      playersOnTeam: teamCurrentPlayers.filter((p) => p._id !== args.playerId)
        .length,
      price: args.newSoldPrice,
    });

    // Adjust team purse
    await ctx.db.patch(team._id, {
      purseRemaining: team.purseRemaining - priceDifference,
      purseSpent: team.purseSpent + priceDifference,
      updatedAt: Date.now(),
    });

    // Update player
    await ctx.db.patch(args.playerId, {
      soldPrice: args.newSoldPrice,
      updatedAt: Date.now(),
    });

    // Log the action
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "update_sold_price",
      targetType: "player",
      targetId: args.playerId,
      previousData: { soldPrice: oldSoldPrice },
      newData: { soldPrice: args.newSoldPrice, reason: args.reason },
      tournamentId: player.tournamentId,
    });

    return { success: true, message: "Sold price updated successfully" };
  },
});

/**
 * Change player auction status
 * - Can mark sold player as unsold (returns to pool)
 * - Can mark unsold player as sold (assigns to team)
 */
export const updatePlayerStatus = mutation({
  args: {
    playerId: v.id("players"),
    newStatus: v.union(
      v.literal("pending"),
      v.literal("sold"),
      v.literal("unsold"),
    ),
    teamId: v.optional(v.id("teams")),
    soldPrice: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const player = await ctx.db.get(args.playerId);
    if (!player) throw new Error("Player not found");

    const oldStatus = player.auctionStatus;
    const oldTeamId = player.teamId;
    const oldSoldPrice = player.soldPrice || 0;

    // If changing TO sold, require team and price
    if (args.newStatus === "sold") {
      if (!args.teamId)
        throw new Error("Team ID required when marking as sold");
      if (!args.soldPrice)
        throw new Error("Sold price required when marking as sold");

      const newTeam = await ctx.db.get(args.teamId);
      if (!newTeam) throw new Error("Team not found");

      if (args.soldPrice > newTeam.purseRemaining) {
        throw new Error("Team has insufficient purse");
      }

      // Squad completion check: after marking as sold, can team still fill remaining slots?
      const tournament = await ctx.db.get(player.tournamentId);
      const teamCurrentPlayers = await ctx.db
        .query("players")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId!))
        .collect();
      assertCanAffordPlayer(tournament, {
        purseRemaining: newTeam.purseRemaining,
        playersOnTeam: teamCurrentPlayers.length,
        price: args.soldPrice,
      });

      // Deduct from new team
      await ctx.db.patch(args.teamId, {
        purseRemaining: newTeam.purseRemaining - args.soldPrice,
        purseSpent: newTeam.purseSpent + args.soldPrice,
        updatedAt: Date.now(),
      });
    }

    // If changing FROM sold, refund old team
    if (oldStatus === "sold" && oldTeamId && args.newStatus !== "sold") {
      const oldTeam = await ctx.db.get(oldTeamId);
      if (oldTeam) {
        await ctx.db.patch(oldTeamId, {
          purseRemaining: oldTeam.purseRemaining + oldSoldPrice,
          purseSpent: oldTeam.purseSpent - oldSoldPrice,
          updatedAt: Date.now(),
        });
      }
    }

    // Update player
    await ctx.db.patch(args.playerId, {
      auctionStatus: args.newStatus,
      teamId: args.newStatus === "sold" ? args.teamId : undefined,
      soldPrice: args.newStatus === "sold" ? args.soldPrice : undefined,
      updatedAt: Date.now(),
    });

    // Log the action
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "update_player_status",
      targetType: "player",
      targetId: args.playerId,
      previousData: {
        status: oldStatus,
        teamId: oldTeamId,
        soldPrice: oldSoldPrice,
      },
      newData: {
        status: args.newStatus,
        teamId: args.teamId,
        soldPrice: args.soldPrice,
        reason: args.reason,
      },
      tournamentId: player.tournamentId,
    });

    // Status changed (pending/sold/unsold) — refresh denormalized counts.
    await syncTournamentAuctionCounts(ctx, player.tournamentId);

    return {
      success: true,
      message: `Player status updated to ${args.newStatus}`,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TEAM MANAGEMENT - Admin can adjust team data during live auction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Adjust team's purse balance directly
 */
export const adjustTeamPurse = mutation({
  args: {
    teamId: v.id("teams"),
    adjustment: v.number(), // Positive to add, negative to deduct
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found");

    const newPurseRemaining = team.purseRemaining + args.adjustment;
    const newPurseSpent = team.purseSpent - args.adjustment;

    if (newPurseRemaining < 0) {
      throw new Error("Adjustment would result in negative purse");
    }

    await ctx.db.patch(args.teamId, {
      purseRemaining: newPurseRemaining,
      purseSpent: Math.max(0, newPurseSpent),
      updatedAt: Date.now(),
    });

    // Log the action
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "adjust_team_purse",
      targetType: "team",
      targetId: args.teamId,
      previousData: {
        purseRemaining: team.purseRemaining,
        purseSpent: team.purseSpent,
      },
      newData: {
        purseRemaining: newPurseRemaining,
        purseSpent: newPurseSpent,
        adjustment: args.adjustment,
        reason: args.reason,
      },
      tournamentId: team.tournamentId,
    });

    return { success: true, message: "Team purse adjusted successfully" };
  },
});

/**
 * Reset team's purse to base purse (removes all players)
 */
export const resetTeamPurse = mutation({
  args: {
    teamId: v.id("teams"),
    releaseAllPlayers: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found");

    const tournament = await ctx.db.get(team.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const basePurse = tournament.settings.basePurse;

    // Optionally release all players from this team
    if (args.releaseAllPlayers) {
      const teamPlayers = await ctx.db
        .query("players")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .collect();

      await Promise.all(
        teamPlayers.map((player) =>
          ctx.db.patch(player._id, {
            teamId: undefined,
            soldPrice: undefined,
            auctionStatus: "unsold",
            updatedAt: Date.now(),
          }),
        ),
      );
    }

    await ctx.db.patch(args.teamId, {
      purseRemaining: basePurse,
      purseSpent: 0,
      updatedAt: Date.now(),
    });

    // Log the action
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "reset_team_purse",
      targetType: "team",
      targetId: args.teamId,
      previousData: {
        purseRemaining: team.purseRemaining,
        purseSpent: team.purseSpent,
      },
      newData: {
        purseRemaining: basePurse,
        purseSpent: 0,
        releaseAllPlayers: args.releaseAllPlayers,
        reason: args.reason,
      },
      tournamentId: team.tournamentId,
    });

    return { success: true, message: "Team purse reset successfully" };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// LIVE BID MANAGEMENT - Admin can modify current auction state
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Override current bid in live auction
 */
export const overrideCurrentBid = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
    teamId: v.id("teams"),
    amount: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    if (args.amount <= 0) {
      throw new Error("Override bid amount must be positive");
    }

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (!auctionRoom.currentPlayerId) {
      throw new Error("No player currently in auction");
    }

    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found");

    // Insert a new bid (this will become the current highest bid)
    await ctx.db.insert("liveBids", {
      auctionRoomId: args.auctionRoomId,
      playerId: auctionRoom.currentPlayerId,
      teamId: args.teamId,
      amount: args.amount,
      timestamp: Date.now(),
    });

    // Log the action
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "override_current_bid",
      targetType: "auction",
      targetId: args.auctionRoomId,
      newData: {
        playerId: auctionRoom.currentPlayerId,
        teamId: args.teamId,
        teamName: team.name,
        amount: args.amount,
        reason: args.reason,
      },
      tournamentId: auctionRoom.tournamentId,
      auctionRoomId: args.auctionRoomId,
    });

    return { success: true, message: "Bid overridden successfully" };
  },
});

/**
 * Clear all bids for current player and restart bidding
 */
export const clearCurrentPlayerBids = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (!auctionRoom.currentPlayerId) {
      throw new Error("No player currently in auction");
    }

    // Get all live bids for this player
    const bids = await ctx.db
      .query("liveBids")
      .withIndex("by_player", (q) =>
        q.eq("playerId", auctionRoom.currentPlayerId!),
      )
      .collect();

    // Delete all live bids sequentially to avoid excessive parallel writes
    const CHUNK_SIZE = 100;
    for (let i = 0; i < bids.length; i += CHUNK_SIZE) {
      const chunk = bids.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map((bid) => ctx.db.delete(bid._id)));
    }

    // Reset timer — liveBids table is now the source of truth; do not write legacy fields
    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    const timerSeconds = tournament?.settings.bidTimerSeconds || 30;

    await ctx.db.patch(args.auctionRoomId, {
      bidTimerEndsAt: Date.now() + timerSeconds * 1000,
      updatedAt: Date.now(),
    });

    // Log the action
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "clear_player_bids",
      targetType: "auction",
      targetId: args.auctionRoomId,
      previousData: { bidCount: bids.length },
      newData: { reason: args.reason },
      tournamentId: auctionRoom.tournamentId,
      auctionRoomId: args.auctionRoomId,
    });

    return { success: true, message: `Cleared ${bids.length} bids` };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES FOR ADMIN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get detailed player info with team for admin view
 */
export const getPlayerWithTeam = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const player = await ctx.db.get(args.playerId);
    if (!player) return null;

    const team = player.teamId ? await ctx.db.get(player.teamId) : null;

    return {
      ...player,
      team: team
        ? {
            _id: team._id,
            name: team.name,
            purseRemaining: team.purseRemaining,
            purseSpent: team.purseSpent,
            colorPrimary: team.colorPrimary,
            logoUrl: team.logoUrl,
          }
        : null,
    };
  },
});
