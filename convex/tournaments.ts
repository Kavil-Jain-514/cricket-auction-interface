import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    settings: v.object({
      basePurse: v.number(),
      minBidIncrement: v.number(),
      bidTimerSeconds: v.number(),
      maxPlayersPerTeam: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    // Get current user (implement auth first)
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Find or create user
    let user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", identity.email!))
      .first();

    // Auto-create user if not found
    if (!user) {
      const userId = await ctx.db.insert("users", {
        email: identity.email!,
        name: identity.name ?? identity.email!.split("@")[0],
        createdAt: Date.now(),
      });
      user = await ctx.db.get(userId);
    }

    const tournamentId = await ctx.db.insert("tournaments", {
      name: args.name,
      description: args.description,
      logoUrl: args.logoUrl,
      createdBy: user._id,
      status: "draft",
      settings: args.settings,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return tournamentId;
  },
});

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", identity.email!))
      .first();

    // Return empty if user hasn't been created yet (will be created on first tournament)
    if (!user) return [];

    return await ctx.db
      .query("tournaments")
      .withIndex("by_creator", (q) => q.eq("createdBy", user._id))
      .order("desc")
      .collect();
  },
});

export const getById = query({
  args: { id: v.id("tournaments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const update = mutation({
  args: {
    id: v.id("tournaments"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("setup"),
        v.literal("active"),
        v.literal("completed"),
      ),
    ),
    settings: v.optional(
      v.object({
        basePurse: v.number(),
        minBidIncrement: v.number(),
        bidTimerSeconds: v.number(),
        maxPlayersPerTeam: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const tournament = await ctx.db.get(args.id);
    if (!tournament) throw new Error("Tournament not found");

    // Prevent editing if auction is active or completed
    if (tournament.status === "active" || tournament.status === "completed") {
      throw new Error("Cannot edit tournament during or after auction");
    }
    const { id, ...updates } = args;

    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const deleteTournament = mutation({
  args: { id: v.id("tournaments") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const tournament = await ctx.db.get(args.id);
    if (!tournament) throw new Error("Tournament not found");

    // Prevent deletion if auction is active
    if (tournament.status === "active") {
      throw new Error("Cannot delete active tournament");
    }

    // Fetch all related data in parallel
    const [teams, players, auctionRooms] = await Promise.all([
      ctx.db
        .query("teams")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.id))
        .collect(),
      ctx.db
        .query("players")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.id))
        .collect(),
      ctx.db
        .query("auctionRooms")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.id))
        .collect(),
    ]);

    // Delete all related data in parallel batches
    const deletePromises: Promise<unknown>[] = [
      ...players.map((player) => ctx.db.delete(player._id)),
      ...teams.map((team) => ctx.db.delete(team._id)),
      ...auctionRooms.map((room) => ctx.db.delete(room._id)),
    ];

    // Also delete related bids and events for each auction room
    for (const room of auctionRooms) {
      const [bids, events] = await Promise.all([
        ctx.db
          .query("bids")
          .withIndex("by_auction_room", (q) => q.eq("auctionRoomId", room._id))
          .collect(),
        ctx.db
          .query("auctionEvents")
          .withIndex("by_auction_room", (q) => q.eq("auctionRoomId", room._id))
          .collect(),
      ]);

      deletePromises.push(
        ...bids.map((bid) => ctx.db.delete(bid._id)),
        ...events.map((event) => ctx.db.delete(event._id)),
      );
    }

    // Execute all deletes then delete tournament
    await Promise.all(deletePromises);
    await ctx.db.delete(args.id);

    return { success: true };
  },
});

// Check if tournament can be edited/deleted
export const canModify = query({
  args: { id: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.id);
    if (!tournament) return { canEdit: false, canDelete: false };

    const canEdit =
      tournament.status !== "active" && tournament.status !== "completed";
    const canDelete = tournament.status !== "active";

    return { canEdit, canDelete };
  },
});
