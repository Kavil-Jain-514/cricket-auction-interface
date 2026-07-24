import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./auth";
import { syncTournamentAuctionCounts } from "./auctionCounts";

// Shared validator for T-shirt size — reused across create, bulkImport, and update
const tshirtSizeValidator = v.optional(
  v.union(
    v.literal("XS"),
    v.literal("S"),
    v.literal("M"),
    v.literal("L"),
    v.literal("XL"),
    v.literal("XXL"),
    v.literal("3XL"),
    v.literal("4XL"),
  ),
);

/** Create a single player for a tournament. Auto-assigns the next sequential playerNumber. */
export const create = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.string(),
    age: v.number(),
    photoUrl: v.optional(v.string()),
    role: v.array(v.string()),
    battingBowlingHand: v.union(
      v.literal("Right-handed"),
      v.literal("Left-handed"),
    ),
    basePrice: v.optional(v.number()),
    jerseyNumber: v.optional(v.number()),
    jerseyName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    tshirtSize: tshirtSizeValidator,
  },
  handler: async (ctx, args) => {
    // Admin only
    await requireAdmin(ctx);

    // Validation
    if (!args.name || args.name.trim().length < 2) {
      throw new Error("Player name must be at least 2 characters");
    }
    if (args.name.trim().length > 50) {
      throw new Error("Player name must be less than 50 characters");
    }
    if (
      args.jerseyNumber !== undefined &&
      (args.jerseyNumber < 1 || args.jerseyNumber > 99)
    ) {
      throw new Error("Jersey number must be between 1 and 99");
    }
    if (args.phoneNumber && !/^[0-9]{10}$/.test(args.phoneNumber)) {
      throw new Error("Phone number must be 10 digits");
    }

    // Verify tournament exists
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found");
    }

    // Get the next player number for this tournament
    const existingPlayers = await ctx.db
      .query("players")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();

    const maxPlayerNumber = existingPlayers.reduce((max, player) => {
      return Math.max(max, player.playerNumber || 0);
    }, 0);
    const nextPlayerNumber = maxPlayerNumber + 1;

    const playerId = await ctx.db.insert("players", {
      tournamentId: args.tournamentId,
      name: args.name,
      phoneNumber: args.phoneNumber,
      age: args.age,
      photoUrl: args.photoUrl,
      role: args.role,
      battingBowlingHand: args.battingBowlingHand,
      basePrice: args.basePrice,
      jerseyNumber: args.jerseyNumber,
      jerseyName: args.jerseyName,
      playerNumber: nextPlayerNumber,
      tshirtSize: args.tshirtSize,
      auctionStatus: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // New pending player — refresh denormalized counts / min pending base price.
    await syncTournamentAuctionCounts(ctx, args.tournamentId);

    return playerId;
  },
});

/**
 * Bulk-import multiple players from a parsed Excel sheet.
 * All inserts run in parallel (Promise.all) since Convex handles concurrency safely.
 * Player numbers continue from the current max to avoid conflicts.
 */
export const bulkImport = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    players: v.array(
      v.object({
        name: v.string(),
        age: v.number(),
        role: v.array(v.string()),
        battingBowlingHand: v.union(
          v.literal("Right-handed"),
          v.literal("Left-handed"),
        ),
        phoneNumber: v.optional(v.string()),
        photoUrl: v.optional(v.string()),
        basePrice: v.optional(v.number()),
        jerseyNumber: v.optional(v.number()),
        jerseyName: v.optional(v.string()),
        tshirtSize: tshirtSizeValidator,
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Admin only
    await requireAdmin(ctx);

    const now = Date.now();

    // Get the current max player number for this tournament
    const existingPlayers = await ctx.db
      .query("players")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();

    const maxPlayerNumber = existingPlayers.reduce((max, player) => {
      return Math.max(max, player.playerNumber || 0);
    }, 0);

    // Batch insert all players with incrementing player numbers
    const insertPromises = args.players.map((player, index) =>
      ctx.db.insert("players", {
        tournamentId: args.tournamentId,
        name: player.name,
        phoneNumber: player.phoneNumber,
        age: player.age,
        photoUrl: player.photoUrl,
        role: player.role,
        battingBowlingHand: player.battingBowlingHand,
        basePrice: player.basePrice,
        jerseyNumber: player.jerseyNumber,
        jerseyName: player.jerseyName,
        playerNumber: maxPlayerNumber + index + 1,
        tshirtSize: player.tshirtSize,
        auctionStatus: "pending",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const playerIds = await Promise.all(insertPromises);

    // Bulk pending insert — refresh denormalized counts once for the batch.
    await syncTournamentAuctionCounts(ctx, args.tournamentId);

    return { count: playerIds.length, ids: playerIds };
  },
});

/**
 * List players for a tournament with optional status filter.
 * Uses the compound `by_tournament_status` index when filtering to avoid a full scan.
 * Phone numbers (PII) are stripped for non-admin viewers.
 */
export const listByTournament = query({
  args: {
    tournamentId: v.id("tournaments"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("sold"),
        v.literal("unsold"),
        v.literal("in_auction"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) return [];

    // Check if the current user is an admin to determine PII visibility
    const identity = await ctx.auth.getUserIdentity();
    let isAdminUser = false;
    if (identity?.email) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", identity.email!))
        .first();
      isAdminUser = user?.role === "admin";
    }

    // Deactivated tournaments are hidden from non-admins even via direct links.
    if (tournament.isActive === false && !isAdminUser) return [];

    // Use the compound index when filtering by status to avoid a full-collection scan.
    const players = args.status
      ? await ctx.db
          .query("players")
          .withIndex("by_tournament_status", (q) =>
            q
              .eq("tournamentId", args.tournamentId)
              .eq("auctionStatus", args.status!),
          )
          .collect()
      : await ctx.db
          .query("players")
          .withIndex("by_tournament", (q) =>
            q.eq("tournamentId", args.tournamentId),
          )
          .collect();

    // Map players to resolve basePrice fallback and strip PII for non-admins
    return players.map((p) => {
      const basePrice = p.basePrice ?? tournament.settings?.basePrice ?? 100000;
      if (isAdminUser) {
        return { ...p, basePrice };
      }
      // Strip phone number for non-admin viewers
      const { phoneNumber: _stripped, ...publicFields } = p;
      return { ...publicFields, basePrice };
    });
  },
});

/** Update player fields. Blocked for sold or in-auction players. */
export const update = mutation({
  args: {
    id: v.id("players"),
    name: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    age: v.optional(v.number()),
    photoUrl: v.optional(v.string()),
    role: v.optional(v.array(v.string())),
    battingBowlingHand: v.optional(
      v.union(v.literal("Right-handed"), v.literal("Left-handed")),
    ),
    basePrice: v.optional(v.number()),
    jerseyNumber: v.optional(v.number()),
    jerseyName: v.optional(v.string()),
    tshirtSize: tshirtSizeValidator,
  },
  handler: async (ctx, args) => {
    // Admin only
    await requireAdmin(ctx);

    const player = await ctx.db.get(args.id);
    if (!player) throw new Error("Player not found");

    // Check if player is already sold
    if (player.auctionStatus === "sold") {
      throw new Error("Cannot edit sold player");
    }

    // Check if auction is active for this player
    if (player.auctionStatus === "in_auction") {
      throw new Error("Cannot edit player currently in auction");
    }

    const { id, ...updates } = args;

    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });

    // basePrice may have changed on a pending player — refresh min pending base
    // price (cheap no-op write when nothing count-relevant actually changed).
    await syncTournamentAuctionCounts(ctx, player.tournamentId);

    return { success: true };
  },
});

/** Delete a player. Cannot delete sold or in-auction players. */
export const deletePlayer = mutation({
  args: { id: v.id("players") },
  handler: async (ctx, args) => {
    // Admin only
    await requireAdmin(ctx);

    const player = await ctx.db.get(args.id);
    if (!player) throw new Error("Player not found");

    // Cannot delete sold players
    if (player.auctionStatus === "sold") {
      throw new Error(
        "Cannot delete sold player. They are assigned to a team.",
      );
    }

    // Cannot delete player in auction
    if (player.auctionStatus === "in_auction") {
      throw new Error("Cannot delete player currently in auction");
    }

    // Unlink from any team that had this player as captain (the denormalized
    // captain display fields are kept, matching manual-entry behavior)
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", player.tournamentId),
      )
      .collect();
    await Promise.all(
      teams
        .filter((t) => t.captainPlayerId === args.id)
        .map((t) =>
          ctx.db.patch(t._id, {
            captainPlayerId: undefined,
            updatedAt: Date.now(),
          }),
        ),
    );

    await ctx.db.delete(args.id);

    // Player removed from the pool — refresh denormalized counts.
    await syncTournamentAuctionCounts(ctx, player.tournamentId);

    return { success: true };
  },
});

/**
 * Delete all pending/unsold players for a tournament.
 * Sold and in-auction players are always skipped unless `includesSold` is true.
 */
export const deleteAllByTournament = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    includesSold: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Admin only
    await requireAdmin(ctx);

    const players = await ctx.db
      .query("players")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();

    // Captains are pre-assigned and never auctioned — every other bulk
    // player view/count in this app excludes them (see getAuctionRoster,
    // syncTournamentAuctionCounts). Bulk delete must match, or the
    // confirmation dialog's counts (which already exclude captains)
    // would understate what actually gets deleted.
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();
    const captainPlayerIds = new Set(
      teams.flatMap((t) => (t.captainPlayerId ? [t.captainPlayerId] : [])),
    );

    // Filter out sold players unless explicitly included, and always skip captains
    const playersToDelete = (
      args.includesSold
        ? players.filter((p) => p.auctionStatus !== "in_auction")
        : players.filter(
            (p) =>
              p.auctionStatus !== "sold" && p.auctionStatus !== "in_auction",
          )
    ).filter((p) => !captainPlayerIds.has(p._id));

    // Delete in parallel for performance
    await Promise.all(playersToDelete.map((p) => ctx.db.delete(p._id)));

    // Bulk removal — refresh denormalized counts once.
    await syncTournamentAuctionCounts(ctx, args.tournamentId);

    return {
      success: true,
      deletedCount: playersToDelete.length,
      skippedCount: players.length - playersToDelete.length,
    };
  },
});
