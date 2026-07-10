import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./auth";

export const create = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.string(),
    ownerName: v.string(),
    sponsorName: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    colorPrimary: v.string(),
    colorSecondary: v.string(),
    // Captain details
    captainName: v.optional(v.string()),
    captainPhotoUrl: v.optional(v.string()),
    captainAge: v.optional(v.number()),
    captainRole: v.optional(
      v.union(
        v.literal("Batter"),
        v.literal("Bowler"),
        v.literal("All-Rounder"),
      ),
    ),
    captainHand: v.optional(v.union(v.literal("Right"), v.literal("Left"))),
  },
  handler: async (ctx, args) => {
    // Admin only
    await requireAdmin(ctx);

    // Validation
    if (!args.name || args.name.trim().length < 2) {
      throw new Error("Team name must be at least 2 characters");
    }
    if (args.name.trim().length > 30) {
      throw new Error("Team name must be less than 30 characters");
    }
    if (!args.ownerName || args.ownerName.trim().length < 2) {
      throw new Error("Owner name must be at least 2 characters");
    }

    // Get tournament to get base purse
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Check for duplicate team name in tournament
    const existingTeams = await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();

    if (
      existingTeams.some(
        (t) => t.name.toLowerCase() === args.name.toLowerCase(),
      )
    ) {
      throw new Error(`Team "${args.name}" already exists in this tournament`);
    }

    const teamId = await ctx.db.insert("teams", {
      tournamentId: args.tournamentId,
      name: args.name,
      ownerName: args.ownerName,
      sponsorName: args.sponsorName,
      logoUrl: args.logoUrl,
      colorPrimary: args.colorPrimary,
      colorSecondary: args.colorSecondary,
      captainName: args.captainName,
      captainPhotoUrl: args.captainPhotoUrl,
      captainAge: args.captainAge,
      captainRole: args.captainRole,
      captainHand: args.captainHand,
      purseRemaining: tournament.settings.basePurse,
      purseSpent: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return teamId;
  },
});

export const listByTournament = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) return [];

    return await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();
  },
});

export const getWithPlayers = query({
  args: { id: v.id("teams") },
  handler: async (ctx, args) => {
    const team = await ctx.db.get(args.id);
    if (!team) return null;

    const players = await ctx.db
      .query("players")
      .withIndex("by_team", (q) => q.eq("teamId", args.id))
      .collect();

    return {
      ...team,
      players,
    };
  },
});

export const update = mutation({
  args: {
    id: v.id("teams"),
    name: v.optional(v.string()),
    ownerName: v.optional(v.string()),
    sponsorName: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    colorPrimary: v.optional(v.string()),
    colorSecondary: v.optional(v.string()),
    // Captain details
    captainName: v.optional(v.string()),
    captainPhotoUrl: v.optional(v.string()),
    captainAge: v.optional(v.number()),
    captainRole: v.optional(
      v.union(
        v.literal("Batter"),
        v.literal("Bowler"),
        v.literal("All-Rounder"),
      ),
    ),
    captainHand: v.optional(v.union(v.literal("Right"), v.literal("Left"))),
  },
  handler: async (ctx, args) => {
    // Admin only
    await requireAdmin(ctx);

    const team = await ctx.db.get(args.id);
    if (!team) throw new Error("Team not found");

    // Check if tournament exists
    const tournament = await ctx.db.get(team.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Cannot edit completed tournament teams
    if (tournament.status === "completed") {
      throw new Error("Cannot edit team after tournament is completed");
    }

    const { id, ...updates } = args;

    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const deleteTeam = mutation({
  args: { id: v.id("teams") },
  handler: async (ctx, args) => {
    // Admin only
    await requireAdmin(ctx);

    const team = await ctx.db.get(args.id);
    if (!team) throw new Error("Team not found");

    // Check if tournament exists
    const tournament = await ctx.db.get(team.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Cannot delete from completed tournament
    if (tournament.status === "completed") {
      throw new Error("Cannot delete team after tournament is completed");
    }

    // Check if team has players - release them first
    const players = await ctx.db
      .query("players")
      .withIndex("by_team", (q) => q.eq("teamId", args.id))
      .collect();

    // Release all players from this team in parallel
    await Promise.all(
      players.map((player) =>
        ctx.db.patch(player._id, {
          teamId: undefined,
          soldPrice: undefined,
          auctionStatus: "pending",
          updatedAt: Date.now(),
        }),
      ),
    );

    await ctx.db.delete(args.id);
    return { success: true, releasedPlayers: players.length };
  },
});
