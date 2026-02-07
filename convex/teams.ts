import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
    // Get tournament to get base purse
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

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
    return await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();
  },
});

export const getById = query({
  args: { id: v.id("teams") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
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
    const team = await ctx.db.get(args.id);
    if (!team) throw new Error("Team not found");

    // Check if tournament is active
    const tournament = await ctx.db.get(team.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    if (tournament.status === "active" || tournament.status === "completed") {
      throw new Error("Cannot edit team during or after auction");
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
    const team = await ctx.db.get(args.id);
    if (!team) throw new Error("Team not found");

    // Check if tournament is active
    const tournament = await ctx.db.get(team.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    if (tournament.status === "active") {
      throw new Error("Cannot delete team during active auction");
    }

    // Check if team has players
    const players = await ctx.db
      .query("players")
      .withIndex("by_team", (q) => q.eq("teamId", args.id))
      .collect();

    if (players.length > 0) {
      throw new Error("Cannot delete team with players. Remove players first.");
    }

    await ctx.db.delete(args.id);
    return { success: true };
  },
});

export const updatePurse = mutation({
  args: {
    id: v.id("teams"),
    purseRemaining: v.number(),
    purseSpent: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      purseRemaining: args.purseRemaining,
      purseSpent: args.purseSpent,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});
