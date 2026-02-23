import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./auth";

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
      basePrice: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    // Admin only
    await requireAdmin(ctx);

    // Validation
    if (!args.name || args.name.trim().length < 3) {
      throw new Error("Tournament name must be at least 3 characters");
    }
    if (args.name.trim().length > 50) {
      throw new Error("Tournament name must be less than 50 characters");
    }
    if (args.settings.basePurse < 100000) {
      throw new Error("Base purse must be at least ₹1 Lakh");
    }
    if (args.settings.basePurse > 1000000000) {
      throw new Error("Base purse cannot exceed ₹100 Crore");
    }
    if (args.settings.minBidIncrement < 5000) {
      throw new Error("Minimum bid increment must be at least ₹5,000");
    }
    if (args.settings.minBidIncrement > args.settings.basePurse / 10) {
      throw new Error("Bid increment cannot exceed 10% of base purse");
    }
    if (args.settings.basePrice !== undefined && args.settings.basePrice < 50000) {
      throw new Error("Base price must be at least ₹50,000");
    }
    if (
      args.settings.bidTimerSeconds < 10 ||
      args.settings.bidTimerSeconds > 120
    ) {
      throw new Error("Bid timer must be between 10 and 120 seconds");
    }
    if (
      args.settings.maxPlayersPerTeam < 11 ||
      args.settings.maxPlayersPerTeam > 30
    ) {
      throw new Error("Max players per team must be between 11 and 30");
    }

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

    if (!user) {
      throw new Error("Failed to create user");
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

// List all tournaments - for viewers to see active tournaments
export const listAll = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    // Return all tournaments ordered by creation date
    return await ctx.db.query("tournaments").order("desc").collect();
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
        basePrice: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Admin only
    await requireAdmin(ctx);

    const tournament = await ctx.db.get(args.id);
    if (!tournament) throw new Error("Tournament not found");

    // Cannot edit completed tournaments
    if (tournament.status === "completed") {
      throw new Error("Cannot edit tournament after it is completed");
    }
    if (args.settings?.basePrice !== undefined && args.settings.basePrice < 50000) {
      throw new Error("Base price must be at least ₹50,000");
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
    // Admin only
    await requireAdmin(ctx);

    const tournament = await ctx.db.get(args.id);
    if (!tournament) throw new Error("Tournament not found");

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

    const canEdit = tournament.status !== "completed";
    const canDelete = true;

    return { canEdit, canDelete };
  },
});
