import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.string(),
    age: v.number(),
    role: v.union(
      v.literal("Batter"),
      v.literal("Bowler"),
      v.literal("All-Rounder"),
    ),
    battingBowlingHand: v.union(v.literal("Right"), v.literal("Left")),
    basePrice: v.number(),
    jerseyNumber: v.optional(v.number()),
    phoneNumber: v.optional(v.string()),
    availability: v.object({
      type: v.union(v.literal("available"), v.literal("unavailable")),
      dates: v.optional(v.array(v.string())),
    }),
    // ... other fields
  },
  handler: async (ctx, args) => {
    const playerId = await ctx.db.insert("players", {
      ...args,
      availability: { type: "available" },
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
    const playerIds = [];

    for (const player of args.players) {
      const id = await ctx.db.insert("players", {
        tournamentId: args.tournamentId,
        ...player,
        auctionStatus: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      playerIds.push(id);
    }

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
