import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./auth";
import {
  computeGroupAssignments,
  validateGroupConfig,
} from "../lib/groupDraw";

export const getByTournament = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("groupDraws")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .first();
  },
});

/**
 * Run (or re-run) the random group draw for a tournament. The full assignment
 * is computed here, server-side, before any client animation — the reveal is
 * only ever a presentation of this persisted result. Re-running replaces the
 * previous assignments unless the draw has been locked.
 */
export const runDraw = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    numGroups: v.number(),
  },
  handler: async (ctx, args) => {
    // Admin only
    const admin = await requireAdmin(ctx);

    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) throw new Error("Tournament not found");
    if (tournament.status === "completed") {
      throw new Error("Cannot run a group draw after tournament is completed");
    }

    const teams = await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();

    const error = validateGroupConfig(teams.length, args.numGroups);
    if (error) throw new Error(error);

    const existing = await ctx.db
      .query("groupDraws")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .first();

    if (existing?.status === "locked") {
      throw new Error(
        "Group draw is locked. Reset the draw before re-shuffling.",
      );
    }

    const assignments = computeGroupAssignments(
      teams.map((t) => t._id),
      args.numGroups,
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        numGroups: args.numGroups,
        status: "drawn",
        assignments,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("groupDraws", {
      tournamentId: args.tournamentId,
      numGroups: args.numGroups,
      status: "drawn",
      assignments,
      createdBy: admin._id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/** Lock the draw so it can no longer be re-shuffled. */
export const lockDraw = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    // Admin only
    await requireAdmin(ctx);

    const draw = await ctx.db
      .query("groupDraws")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .first();

    if (!draw) throw new Error("No group draw found for this tournament");
    if (draw.status === "locked") return { success: true };

    await ctx.db.patch(draw._id, {
      status: "locked",
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Delete the draw entirely (works even when locked). Guarded by an explicit
 * confirmation in the UI.
 */
export const resetDraw = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    // Admin only
    await requireAdmin(ctx);

    const draw = await ctx.db
      .query("groupDraws")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .first();

    if (!draw) throw new Error("No group draw found for this tournament");

    await ctx.db.delete(draw._id);
    return { success: true };
  },
});
