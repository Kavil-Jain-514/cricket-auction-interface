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

export const update = mutation({
  args: {
    id: v.id("teams"),
    name: v.optional(v.string()),
    ownerName: v.optional(v.string()),
    sponsorName: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    colorPrimary: v.optional(v.string()),
    colorSecondary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
