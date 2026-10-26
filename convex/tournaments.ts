import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, logAdminAction, requireAdmin } from "./auth";

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    settings: v.object({
      basePurse: v.number(),
      minBidIncrement: v.number(),
      // Bid timer is no longer configurable in the UI; kept optional for
      // backward compatibility. Defaults to 30s server-side where needed.
      bidTimerSeconds: v.optional(v.number()),
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
    // Bid timer is no longer set from the UI, but validate any value a client
    // does send so a bad number can't corrupt bidTimerEndsAt math later.
    if (
      args.settings.bidTimerSeconds !== undefined &&
      (!Number.isFinite(args.settings.bidTimerSeconds) ||
        args.settings.bidTimerSeconds < 10 ||
        args.settings.bidTimerSeconds > 120)
    ) {
      throw new Error("Bid timer must be between 10 and 120 seconds");
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
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    if (args.limit !== undefined && args.limit <= 0) {
      throw new Error("limit must be a positive number");
    }
    // Non-admins never see deactivated tournaments (isActive === false).
    // Legacy tournaments with isActive === undefined stay visible.
    const user = await getCurrentUser(ctx);
    const isAdmin = user?.role === "admin";
    const visible = (t: { isActive?: boolean }) => isAdmin || t.isActive !== false;

    const tournamentsQuery = ctx.db.query("tournaments").order("desc");
    if (args.limit === undefined) {
      return (await tournamentsQuery.collect()).filter(visible);
    }
    const cap = Math.max(1, Math.min(args.limit, 100));
    // Over-fetch so the post-filter still has a chance to fill the cap.
    const fetched = await tournamentsQuery.take(isAdmin ? cap : cap * 2);
    return fetched.filter(visible).slice(0, cap);
  },
});

export const getById = query({
  args: { id: v.id("tournaments") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const tournament = await ctx.db.get(args.id);
    if (!tournament) return null;

    // Deactivated tournaments are only reachable by admins.
    if (tournament.isActive === false) {
      const user = await getCurrentUser(ctx);
      if (user?.role !== "admin") return null;
    }

    return tournament;
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
        // Optional: no longer set from the UI (see create).
        bidTimerSeconds: v.optional(v.number()),
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

    // Merged settings we'll actually write (preserving the legacy bid timer).
    let nextSettings = args.settings;

    if (args.settings) {
      // Settings are locked once the auction is actually running (live/paused).
      // To change them, the admin must restart the auction (which returns the
      // room to "waiting"). This keeps every place that reads the settings
      // consistent for the duration of a live auction.
      const rooms = await ctx.db
        .query("auctionRooms")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.id))
        .collect();
      const auctionRunning = rooms.some(
        (r) => r.status === "live" || r.status === "paused",
      );
      if (auctionRunning) {
        throw new Error(
          "Settings are locked while the auction is running. Restart the auction to change settings.",
        );
      }

      // Guard against maxPlayersPerTeam being dropped below a team's already
      // -sold squad size — startNextPlayer treats that team as "full" and can
      // end the auction early for everyone else.
      const soldPlayers = await ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q.eq("tournamentId", args.id).eq("auctionStatus", "sold"),
        )
        .collect();
      const maxSoldForOneTeam = soldPlayers.reduce((counts, p) => {
        if (p.teamId) counts.set(p.teamId, (counts.get(p.teamId) ?? 0) + 1);
        return counts;
      }, new Map<string, number>());
      const highestSquadSize = Math.max(0, ...maxSoldForOneTeam.values());
      if (args.settings.maxPlayersPerTeam < highestSquadSize) {
        throw new Error(
          `Max players per team can't be less than ${highestSquadSize} — a team already has that many sold players`,
        );
      }

      // Bid timer is no longer set from the UI, but validate any value a client
      // does send so a bad number can't corrupt bidTimerEndsAt math later.
      if (
        args.settings.bidTimerSeconds !== undefined &&
        (!Number.isFinite(args.settings.bidTimerSeconds) ||
          args.settings.bidTimerSeconds < 10 ||
          args.settings.bidTimerSeconds > 120)
      ) {
        throw new Error("Bid timer must be between 10 and 120 seconds");
      }

      // Preserve the (hidden) bid timer if the caller didn't send one.
      nextSettings = {
        ...args.settings,
        bidTimerSeconds:
          args.settings.bidTimerSeconds ??
          tournament.settings.bidTimerSeconds ??
          30,
      };

      // Base purse is denormalized onto each team's purse. When it changes,
      // propagate it so the new value is reflected everywhere in the tournament.
      // (Settings are only editable pre-auction, so purseSpent is 0 here.)
      if (args.settings.basePurse !== tournament.settings.basePurse) {
        const teams = await ctx.db
          .query("teams")
          .withIndex("by_tournament", (q) => q.eq("tournamentId", args.id))
          .collect();
        await Promise.all(
          teams.map((team) =>
            ctx.db.patch(team._id, {
              purseRemaining: Math.max(
                0,
                args.settings!.basePurse - team.purseSpent,
              ),
              updatedAt: Date.now(),
            }),
          ),
        );
      }
    }

    const { id, settings: _settings, ...rest } = args;

    await ctx.db.patch(id, {
      ...rest,
      ...(nextSettings ? { settings: nextSettings } : {}),
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Toggle a tournament's visibility. Deactivated tournaments are hidden from
// non-admin listings and cannot be opened by non-admins (see getById / listAll).
export const setActive = mutation({
  args: {
    id: v.id("tournaments"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const tournament = await ctx.db.get(args.id);
    if (!tournament) throw new Error("Tournament not found");

    const previous = tournament.isActive !== false; // legacy undefined = active
    if (previous === args.isActive) {
      return { success: true };
    }

    await ctx.db.patch(args.id, {
      isActive: args.isActive,
      updatedAt: Date.now(),
    });

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: args.isActive ? "activate_tournament" : "deactivate_tournament",
      targetType: "tournament",
      targetId: args.id,
      previousData: { isActive: previous },
      newData: { isActive: args.isActive },
      tournamentId: args.id,
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
    const [teams, players, auctionRooms, groupDraws] = await Promise.all([
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
      ctx.db
        .query("groupDraws")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.id))
        .collect(),
    ]);

    // Fetch bids and events for all auction rooms in a single parallel batch
    // (avoids a sequential loop of round-trips per room).
    const roomRelated = await Promise.all(
      auctionRooms.map((room) =>
        Promise.all([
          ctx.db
            .query("bids")
            .withIndex("by_auction_room", (q) =>
              q.eq("auctionRoomId", room._id),
            )
            .collect(),
          ctx.db
            .query("auctionEvents")
            .withIndex("by_auction_room", (q) =>
              q.eq("auctionRoomId", room._id),
            )
            .collect(),
          ctx.db
            .query("liveBids")
            .withIndex("by_room", (q) => q.eq("auctionRoomId", room._id))
            .collect(),
        ]),
      ),
    );

    // Helper: delete in sequential chunks to stay within Convex's per-mutation
    // write limit (~1000 ops) and avoid partial-deletion if the mutation times out.
    async function deleteInChunks(
      ids: { _id: Parameters<typeof ctx.db.delete>[0] }[],
      chunkSize = 200,
    ) {
      for (let i = 0; i < ids.length; i += chunkSize) {
        await Promise.all(
          ids.slice(i, i + chunkSize).map((doc) => ctx.db.delete(doc._id)),
        );
      }
    }

    // Delete deepest children first so a mid-flight failure never leaves
    // dangling references pointing at already-deleted parents.

    // 1. Room-level children: bids, events, liveBids
    const allBids = roomRelated.flatMap(([bids]) => bids);
    const allEvents = roomRelated.flatMap(([, events]) => events);
    const allLiveBids = roomRelated.flatMap(([, , liveBids]) => liveBids);
    await deleteInChunks(allBids);
    await deleteInChunks(allEvents);
    await deleteInChunks(allLiveBids);

    // 2. Mid-level: group draws, players, teams, auction rooms
    await deleteInChunks(groupDraws);
    await deleteInChunks(players);
    await deleteInChunks(teams);
    await deleteInChunks(auctionRooms);

    // 3. Tournament itself
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
