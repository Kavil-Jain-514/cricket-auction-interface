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
    // ... other fields
  },
  handler: async (ctx, args) => {
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

export const assignToTeam = mutation({
  args: {
    playerId: v.id("players"),
    teamId: v.id("teams"),
    soldPrice: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.playerId, {
      teamId: args.teamId,
      soldPrice: args.soldPrice,
      auctionStatus: "sold",
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});
