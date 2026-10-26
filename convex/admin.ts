// convex/admin.ts - Admin-only mutations for managing auction data
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireAdmin, logAdminAction } from "./auth";
import { syncTournamentAuctionCounts } from "./auctionCounts";
import {
  bidTimerEndsAt,
  DEFAULT_BASE_PRICE,
  isSquadFull,
  maxAllowedBid,
  reserveBasePrice,
  teamPurseTotal,
} from "./bidRules";
import type { Doc, Id } from "./_generated/dataModel";

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

/**
 * Corrections are only allowed on players outside the live block and outside
 * the captain slots. A player on the block would be double-settled by
 * finalizePlayerSale; captains are pre-assigned and never auctioned.
 */
async function assertCorrectable(ctx: MutationCtx, player: Doc<"players">) {
  if (player.auctionStatus === "in_auction") {
    throw new Error("Player is on the block; finalise first");
  }
  const teams = await ctx.db
    .query("teams")
    .withIndex("by_tournament", (q) =>
      q.eq("tournamentId", player.tournamentId),
    )
    .collect();
  const captainOf = teams.find((t) => t.captainPlayerId === player._id);
  if (captainOf) {
    throw new Error(
      `${player.name} is the captain of ${captainOf.name} and is not part of the auction`,
    );
  }
}

/**
 * Re-price a player already sold to `team`: checks the price difference fits
 * the purse and the squad reserve, then moves only the difference.
 */
async function applySoldPriceChange(
  ctx: MutationCtx,
  args: {
    player: Doc<"players">;
    team: Doc<"teams">;
    newPrice: number;
    tournament: Doc<"tournaments"> | null;
  },
) {
  const { player, team, newPrice, tournament } = args;
  const oldSoldPrice = player.soldPrice || 0;
  const priceDifference = newPrice - oldSoldPrice;

  // Check if team has enough purse for price increase
  if (priceDifference > 0 && priceDifference > team.purseRemaining) {
    throw new Error(
      `Team has insufficient purse for price increase. Available: ₹${team.purseRemaining}`,
    );
  }

  // Squad completion check: after price change, can team still fill remaining slots?
  const teamCurrentPlayers = await ctx.db
    .query("players")
    .withIndex("by_team", (q) => q.eq("teamId", team._id))
    .collect();
  // Price the player as if re-bought: refund their old price, exclude them from the count.
  assertCanAffordPlayer(tournament, {
    purseRemaining: team.purseRemaining + oldSoldPrice,
    playersOnTeam: teamCurrentPlayers.filter((p) => p._id !== player._id)
      .length,
    price: newPrice,
  });

  await ctx.db.patch(team._id, {
    purseRemaining: team.purseRemaining - priceDifference,
    purseSpent: team.purseSpent + priceDifference,
    updatedAt: Date.now(),
  });
}

/** Return a sold player's price to their team (no-op if not sold). */
async function refundSoldPlayer(ctx: MutationCtx, player: Doc<"players">) {
  const soldPrice = player.soldPrice || 0;
  if (player.auctionStatus !== "sold" || !player.teamId || soldPrice <= 0) {
    return null;
  }
  const team = await ctx.db.get(player.teamId);
  if (!team) return null;
  await ctx.db.patch(team._id, {
    purseRemaining: team.purseRemaining + soldPrice,
    purseSpent: team.purseSpent - soldPrice,
    updatedAt: Date.now(),
  });
  return team;
}

/**
 * Debit `price` from a team for a player who is not (or no longer) counted
 * against it. Reads the team fresh so a refund earlier in the same mutation is
 * seen.
 */
async function debitTeamForPlayer(
  ctx: MutationCtx,
  args: {
    teamId: Id<"teams">;
    playerId: Id<"players">;
    price: number;
    tournament: Doc<"tournaments"> | null;
  },
) {
  const team = await ctx.db.get(args.teamId);
  if (!team) throw new Error("Team not found");

  if (args.price > team.purseRemaining) {
    throw new Error(
      `Team has insufficient purse. Available: ₹${team.purseRemaining}, Required: ₹${args.price}`,
    );
  }

  // Squad completion check: after this sale, can the team still fill remaining slots?
  const teamCurrentPlayers = await ctx.db
    .query("players")
    .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
    .collect();
  assertCanAffordPlayer(args.tournament, {
    purseRemaining: team.purseRemaining,
    playersOnTeam: teamCurrentPlayers.filter((p) => p._id !== args.playerId)
      .length,
    price: args.price,
  });

  await ctx.db.patch(args.teamId, {
    purseRemaining: team.purseRemaining - args.price,
    purseSpent: team.purseSpent + args.price,
    updatedAt: Date.now(),
  });
  return team;
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYER MANAGEMENT - Admin can modify ANY player data during live auction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reassign a sold player to a different team
 * - Updates player's teamId
 * - Adjusts purse balances for both teams
 * - Optionally adjust sold price
 * - Reassigning to the player's current team only re-prices them
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

    if (newTeam.tournamentId !== player.tournamentId) {
      throw new Error("New team is not part of this player's tournament");
    }

    await assertCorrectable(ctx, player);

    const oldTeamId = player.teamId;
    const oldSoldPrice = player.soldPrice || 0;
    const newSoldPrice = args.newSoldPrice ?? oldSoldPrice;
    const tournament = await ctx.db.get(player.tournamentId);

    // Get old team if exists
    const oldTeam = oldTeamId ? await ctx.db.get(oldTeamId) : null;

    if (player.auctionStatus === "sold" && oldTeamId === args.newTeamId) {
      // Same team: refunding then debiting would read a stale purse, so move
      // only the price difference.
      if (newSoldPrice !== oldSoldPrice) {
        await applySoldPriceChange(ctx, {
          player,
          team: newTeam,
          newPrice: newSoldPrice,
          tournament,
        });
      }
    } else {
      // Refund old team's purse if player was previously sold, then debit the
      // new team (read fresh inside debitTeamForPlayer).
      await refundSoldPlayer(ctx, player);
      await debitTeamForPlayer(ctx, {
        teamId: args.newTeamId,
        playerId: args.playerId,
        price: newSoldPrice,
        tournament,
      });
    }

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

    // Status may have changed (pending/unsold -> sold) — refresh denormalized counts.
    await syncTournamentAuctionCounts(ctx, player.tournamentId);

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

    await assertCorrectable(ctx, player);

    if (player.auctionStatus !== "sold" || !player.teamId) {
      throw new Error("Player is not sold to any team");
    }

    const team = await ctx.db.get(player.teamId);
    if (!team) throw new Error("Team not found");

    const oldSoldPrice = player.soldPrice || 0;
    const tournament = await ctx.db.get(player.tournamentId);

    await applySoldPriceChange(ctx, {
      player,
      team,
      newPrice: args.newSoldPrice,
      tournament,
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
 * - sold -> sold refunds the old team before debiting the new one
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

    await assertCorrectable(ctx, player);

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
      if (newTeam.tournamentId !== player.tournamentId) {
        throw new Error("Team is not part of this player's tournament");
      }
    }

    // If the player was sold, refund the old team FIRST — whatever the new
    // status — so a sold -> sold change never double-counts.
    await refundSoldPlayer(ctx, player);

    if (args.newStatus === "sold") {
      const tournament = await ctx.db.get(player.tournamentId);
      await debitTeamForPlayer(ctx, {
        teamId: args.teamId!,
        playerId: args.playerId,
        price: args.soldPrice!,
        tournament,
      });
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
// LIVE BID MANAGEMENT - Admin can modify current auction state
// ═══════════════════════════════════════════════════════════════════════════

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
    const reason = requireReason(args.reason);

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
    const now = Date.now();

    await ctx.db.patch(args.auctionRoomId, {
      bidTimerEndsAt: bidTimerEndsAt(tournament?.settings ?? {}, now),
      updatedAt: now,
    });

    // Log the action
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "clear_player_bids",
      targetType: "auction",
      targetId: args.auctionRoomId,
      previousData: { bidCount: bids.length },
      newData: { reason },
      tournamentId: auctionRoom.tournamentId,
      auctionRoomId: args.auctionRoomId,
    });

    return { success: true, message: `Cleared ${bids.length} bids` };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PURSE TOOLS — keep remaining + spent == basePurse + purseAdjustment
// ═══════════════════════════════════════════════════════════════════════════

const MAX_REASON_LENGTH = 200;

/** Trimmed reason; throws when blank (every money change must say why). */
function requireReason(raw: string): string {
  const reason = raw.trim();
  if (reason === "") throw new Error("A reason is required");
  if (reason.length > MAX_REASON_LENGTH) {
    throw new Error(`Keep the reason to ${MAX_REASON_LENGTH} characters or fewer`);
  }
  return reason;
}

/**
 * Give a team money or take it away outside a sale (a penalty, a sponsor
 * top-up). Recorded in team.purseAdjustment so the reconciliation stays ok:
 * remaining moves by `amount`, spent is untouched.
 */
export const adjustTeamPurse = mutation({
  args: {
    teamId: v.id("teams"),
    amount: v.number(), // positive adds, negative deducts
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const reason = requireReason(args.reason);
    if (!Number.isInteger(args.amount) || args.amount === 0) {
      throw new Error("Adjustment must be a non-zero whole number of rupees");
    }

    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found");

    const purseRemaining = team.purseRemaining + args.amount;
    if (purseRemaining < 0) {
      throw new Error(
        `That would take ${team.name}'s purse below zero (${formatPurse(team.purseRemaining)} left)`,
      );
    }
    const purseAdjustment = (team.purseAdjustment ?? 0) + args.amount;

    await ctx.db.patch(args.teamId, {
      purseRemaining,
      purseAdjustment,
      updatedAt: Date.now(),
    });

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "adjust_team_purse",
      targetType: "team",
      targetId: args.teamId,
      previousData: {
        purseRemaining: team.purseRemaining,
        purseAdjustment: team.purseAdjustment ?? 0,
      },
      newData: { purseRemaining, purseAdjustment, amount: args.amount, reason },
      tournamentId: team.tournamentId,
    });

    return { success: true, purseRemaining, purseAdjustment };
  },
});

/**
 * Repair a team's purse from the source of truth: spent = sum of its sold
 * players' prices, remaining = basePurse + purseAdjustment - spent. Replaces
 * the old resetTeamPurse, which zeroed the purse even with players sold.
 */
export const recalculateTeamPurse = mutation({
  args: {
    teamId: v.id("teams"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const reason = requireReason(args.reason);

    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found");
    const tournament = await ctx.db.get(team.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const players = await ctx.db
      .query("players")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    const purseSpent = players
      .filter((p) => p.auctionStatus === "sold")
      .reduce((sum, p) => sum + (p.soldPrice ?? 0), 0);
    const purseRemaining =
      teamPurseTotal(tournament.settings.basePurse, team) - purseSpent;
    if (purseRemaining < 0) {
      throw new Error(
        `${team.name}'s sold players cost ${formatPurse(purseSpent)}, more than its purse. Correct the sold prices first.`,
      );
    }

    await ctx.db.patch(args.teamId, {
      purseRemaining,
      purseSpent,
      updatedAt: Date.now(),
    });

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "recalculate_team_purse",
      targetType: "team",
      targetId: args.teamId,
      previousData: {
        purseRemaining: team.purseRemaining,
        purseSpent: team.purseSpent,
      },
      newData: { purseRemaining, purseSpent, reason },
      tournamentId: team.tournamentId,
    });

    return { success: true, purseRemaining, purseSpent };
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
