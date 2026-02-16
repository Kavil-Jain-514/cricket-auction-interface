import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.string(),
    age: v.number(),
    photoUrl: v.optional(v.string()),
    role: v.union(
      v.literal("Batter"),
      v.literal("Bowler"),
      v.literal("All-Rounder"),
    ),
    battingBowlingHand: v.union(
      v.literal("Right-handed"),
      v.literal("Left-handed"),
    ),
    availability: v.object({
      type: v.union(v.literal("available"), v.literal("unavailable")),
      dates: v.optional(v.array(v.string())),
    }),
    basePrice: v.number(),
    jerseyNumber: v.optional(v.number()),
    phoneNumber: v.optional(v.string()),
    tshirtSize: v.optional(
      v.union(
        v.literal("S"),
        v.literal("M"),
        v.literal("L"),
        v.literal("XL"),
        v.literal("XXL"),
        v.literal("3XL"),
        v.literal("4XL"),
      ),
    ),
    // ... other fields
  },
  handler: async (ctx, args) => {
    // Validation
    if (!args.name || args.name.trim().length < 2) {
      throw new Error("Player name must be at least 2 characters");
    }
    if (args.name.trim().length > 50) {
      throw new Error("Player name must be less than 50 characters");
    }
    if (args.age < 15 || args.age > 65) {
      throw new Error("Player age must be between 15 and 65");
    }
    if (args.basePrice < 50000) {
      throw new Error("Base price must be at least ₹50,000");
    }
    if (args.basePrice > 50000000) {
      throw new Error("Base price cannot exceed ₹5 Crore");
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

    const playerId = await ctx.db.insert("players", {
      tournamentId: args.tournamentId,
      name: args.name,
      phoneNumber: args.phoneNumber,
      age: args.age,
      photoUrl: args.photoUrl,
      role: args.role,
      availability: args.availability,
      battingBowlingHand: args.battingBowlingHand,
      basePrice: args.basePrice,
      jerseyNumber: args.jerseyNumber,
      tshirtSize: args.tshirtSize,
      auctionStatus: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return playerId;
  },
});

export const bulkImport = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    players: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Batch insert all players in parallel for much better performance
    const insertPromises = args.players.map((player) =>
      ctx.db.insert("players", {
        tournamentId: args.tournamentId,
        name: player.name,
        phoneNumber: player.phoneNumber,
        age: player.age,
        photoUrl: player.photoUrl,
        role: player.role,
        availability: player.availability,
        battingBowlingHand: player.battingBowlingHand,
        basePrice: player.basePrice,
        jerseyNumber: player.jerseyNumber,
        tshirtSize: player.tshirtSize,
        auctionStatus: "pending",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const playerIds = await Promise.all(insertPromises);
    return { count: playerIds.length, ids: playerIds };
  },
});

export const listByTournament = query({
  args: {
    tournamentId: v.id("tournaments"),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const query = ctx.db
      .query("players")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      );

    const players = await query.collect();

    if (args.status) {
      return players.filter((p) => p.auctionStatus === args.status);
    }

    return players;
  },
});

export const update = mutation({
  args: {
    id: v.id("players"),
    name: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    age: v.optional(v.number()),
    photoUrl: v.optional(v.string()),
    role: v.optional(
      v.union(
        v.literal("Batter"),
        v.literal("Bowler"),
        v.literal("All-Rounder"),
      ),
    ),
    battingBowlingHand: v.optional(
      v.union(v.literal("Right-handed"), v.literal("Left-handed")),
    ),
    basePrice: v.optional(v.number()),
    jerseyNumber: v.optional(v.number()),
    tshirtSize: v.optional(
      v.union(
        v.literal("S"),
        v.literal("M"),
        v.literal("L"),
        v.literal("XL"),
        v.literal("XXL"),
        v.literal("3XL"),
        v.literal("4XL"),
      ),
    ),
    availability: v.optional(
      v.object({
        type: v.union(v.literal("available"), v.literal("unavailable")),
        dates: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (ctx, args) => {
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

    return { success: true };
  },
});

export const deletePlayer = mutation({
  args: { id: v.id("players") },
  handler: async (ctx, args) => {
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

    await ctx.db.delete(args.id);
    return { success: true };
  },
});

export const deleteAllByTournament = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    includesSold: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const players = await ctx.db
      .query("players")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();

    // Filter out sold players unless explicitly included
    const playersToDelete = args.includesSold
      ? players.filter((p) => p.auctionStatus !== "in_auction")
      : players.filter(
          (p) => p.auctionStatus !== "sold" && p.auctionStatus !== "in_auction",
        );

    // Delete in parallel for performance
    await Promise.all(playersToDelete.map((p) => ctx.db.delete(p._id)));

    return {
      success: true,
      deletedCount: playersToDelete.length,
      skippedCount: players.length - playersToDelete.length,
    };
  },
});
