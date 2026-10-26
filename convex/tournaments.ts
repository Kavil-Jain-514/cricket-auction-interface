import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, logAdminAction, requireAdmin } from "./auth";
import type { Doc } from "./_generated/dataModel";
import {
  DEFAULT_BASE_PRICE,
  DEFAULT_BID_TIMER_SECONDS,
  teamPurseTotal,
  validateBidTimerSeconds,
} from "./bidRules";
import {
  categoryValidator,
  incrementSlabValidator,
  presentationOrderValidator,
  squadRuleValidator,
} from "./ruleValidators";
import { syncTournamentAuctionCounts } from "./auctionCounts";
import {
  normalizeFooterText,
  validateCategories,
  validateIncrementSlabs,
  validateSettings,
  validateSquadRules,
  validateTournamentName,
} from "./validation";

// Who may bid (see schema.ts). Not a locked setting: the auctioneer can fall
// back to "admin_only" mid-auction.
const bidModeValidator = v.optional(
  v.union(v.literal("admin_only"), v.literal("confirm"), v.literal("open")),
);

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    settings: v.object({
      basePurse: v.number(),
      minBidIncrement: v.number(),
      // Advisory countdown: 0 = off, 10–120s. Absent = 30s (older clients).
      bidTimerSeconds: v.optional(v.number()),
      maxPlayersPerTeam: v.number(),
      basePrice: v.optional(v.number()),
      footerText: v.optional(v.string()),
      bidMode: bidModeValidator,
      categories: v.optional(v.array(categoryValidator)),
      incrementSlabs: v.optional(v.array(incrementSlabValidator)),
      presentationOrder: presentationOrderValidator,
      squadRules: v.optional(v.array(squadRuleValidator)),
    }),
  },
  handler: async (ctx, args) => {
    // Admin only
    await requireAdmin(ctx);

    // Validation (shared with update — convex/validation.ts)
    const error =
      validateTournamentName(args.name) ?? validateSettings(args.settings);
    if (error) throw new Error(error);

    // Bid timer: 0 = off, else 10–120s. Omitted means the 30s default.
    if (args.settings.bidTimerSeconds !== undefined) {
      const timerError = validateBidTimerSeconds(args.settings.bidTimerSeconds);
      if (timerError) throw new Error(timerError);
    }
    const rulesError = validateRuleSettings(args.settings);
    if (rulesError) throw new Error(rulesError);
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

    const footer = normalizeFooterText(args.settings.footerText);
    if (!footer.ok) throw new Error(footer.error);

    const tournamentId = await ctx.db.insert("tournaments", {
      name: args.name,
      description: args.description,
      logoUrl: args.logoUrl,
      createdBy: user._id,
      status: "draft",
      settings: { ...args.settings, footerText: footer.text },
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

type TournamentSettings = Doc<"tournaments">["settings"];

/**
 * True when a money or squad setting differs from what is stored. Absent
 * optional values compare as their server-side defaults, so a client that
 * resends the defaults does not trip the live-auction lock.
 */
function settingsChanged(
  current: TournamentSettings,
  next: TournamentSettings,
): boolean {
  return (
    next.basePurse !== current.basePurse ||
    next.minBidIncrement !== current.minBidIncrement ||
    next.maxPlayersPerTeam !== current.maxPlayersPerTeam ||
    (next.basePrice ?? DEFAULT_BASE_PRICE) !==
      (current.basePrice ?? DEFAULT_BASE_PRICE) ||
    (next.bidTimerSeconds !== undefined &&
      next.bidTimerSeconds !==
        (current.bidTimerSeconds ?? DEFAULT_BID_TIMER_SECONDS)) ||
    (next.categories !== undefined &&
      !sameJson(next.categories, current.categories ?? [])) ||
    (next.incrementSlabs !== undefined &&
      !sameJson(next.incrementSlabs, current.incrementSlabs ?? [])) ||
    (next.presentationOrder !== undefined &&
      next.presentationOrder !== (current.presentationOrder ?? "random")) ||
    (next.squadRules !== undefined &&
      !sameJson(next.squadRules, current.squadRules ?? []))
  );
}

/** Order-sensitive structural equality for small settings arrays. */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Categories, increment slabs and squad rules, checked against the new settings. */
function validateRuleSettings(settings: {
  basePurse: number;
  maxPlayersPerTeam: number;
  categories?: TournamentSettings["categories"];
  incrementSlabs?: TournamentSettings["incrementSlabs"];
  squadRules?: TournamentSettings["squadRules"];
}): string | null {
  return (
    (settings.categories
      ? validateCategories(settings.categories, settings.basePurse)
      : null) ??
    (settings.incrementSlabs
      ? validateIncrementSlabs(settings.incrementSlabs, settings.basePurse)
      : null) ??
    (settings.squadRules
      ? validateSquadRules(
          settings.squadRules,
          (settings.categories ?? []).map((c) => c.id),
          settings.maxPlayersPerTeam,
        )
      : null)
  );
}

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
        // Optional: omitted keeps the stored value (see create).
        bidTimerSeconds: v.optional(v.number()),
        maxPlayersPerTeam: v.number(),
        basePrice: v.optional(v.number()),
        // Not a locked setting: editable during a live auction.
        footerText: v.optional(v.string()),
        // Not a locked setting either (see bidModeValidator).
        bidMode: bidModeValidator,
        // Locked while live. Omitted keeps the stored value; [] clears it.
        categories: v.optional(v.array(categoryValidator)),
        incrementSlabs: v.optional(v.array(incrementSlabValidator)),
        presentationOrder: presentationOrderValidator,
        squadRules: v.optional(v.array(squadRuleValidator)),
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

    if (args.name !== undefined) {
      const nameError = validateTournamentName(args.name);
      if (nameError) throw new Error(nameError);
    }

    // Merged settings we'll actually write (preserving the stored bid timer).
    // Stays undefined when the caller sent settings identical to the stored
    // ones, so name/description/logo edits work during a live auction.
    let nextSettings: typeof args.settings = undefined;

    // Footer text is presentation only — never locked. An omitted footerText
    // keeps the stored one; an empty string clears it.
    let footerText = tournament.settings.footerText;
    if (args.settings?.footerText !== undefined) {
      const footer = normalizeFooterText(args.settings.footerText);
      if (!footer.ok) throw new Error(footer.error);
      footerText = footer.text;
      if (footerText !== tournament.settings.footerText) {
        nextSettings = { ...tournament.settings, footerText };
      }
    }

    // Bid mode is never locked either. An omitted bidMode keeps the stored one.
    const bidMode = args.settings?.bidMode ?? tournament.settings.bidMode;
    if (bidMode !== tournament.settings.bidMode) {
      nextSettings = { ...(nextSettings ?? tournament.settings), bidMode };
    }

    if (args.settings && settingsChanged(tournament.settings, args.settings)) {
      const settingsError = validateSettings(args.settings);
      if (settingsError) throw new Error(settingsError);

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

      // Bid timer: 0 = off, else 10–120s (see create).
      if (args.settings.bidTimerSeconds !== undefined) {
        const timerError = validateBidTimerSeconds(
          args.settings.bidTimerSeconds,
        );
        if (timerError) throw new Error(timerError);
      }

      // Categories and slabs: omitted keeps the stored ones.
      const categories =
        args.settings.categories ?? tournament.settings.categories;
      const incrementSlabs =
        args.settings.incrementSlabs ?? tournament.settings.incrementSlabs;
      const squadRules =
        args.settings.squadRules ?? tournament.settings.squadRules;

      // Removing a category a squad rule still uses gets a clearer message
      // than the generic "rule refers to a category that doesn't exist".
      const categoryIds = new Set((categories ?? []).map((c) => c.id));
      const orphaned = (squadRules ?? []).find(
        (r) => r.categoryId !== undefined && !categoryIds.has(r.categoryId),
      );
      const orphanedName = tournament.settings.categories?.find(
        (c) => c.id === orphaned?.categoryId,
      )?.name;
      if (orphaned && orphanedName && !args.settings.squadRules) {
        throw new Error(
          `${orphanedName} is used by a squad rule. Remove the rule first.`,
        );
      }

      const rulesError = validateRuleSettings({
        basePurse: args.settings.basePurse,
        maxPlayersPerTeam: args.settings.maxPlayersPerTeam,
        categories,
        incrementSlabs,
        squadRules,
      });
      if (rulesError) throw new Error(rulesError);

      // A category still assigned to players can't be removed: their base
      // price would silently fall back to the tournament default.
      const keptIds = new Set((categories ?? []).map((c) => c.id));
      const removed = (tournament.settings.categories ?? []).filter(
        (c) => !keptIds.has(c.id),
      );
      if (removed.length > 0) {
        const players = await ctx.db
          .query("players")
          .withIndex("by_tournament", (q) => q.eq("tournamentId", args.id))
          .collect();
        for (const category of removed) {
          const inUse = players.filter((p) => p.categoryId === category.id);
          if (inUse.length > 0) {
            throw new Error(
              `${inUse.length} player${inUse.length === 1 ? " is" : "s are"} still in ${category.name}. Move them to another category first.`,
            );
          }
        }
      }

      // Keep the stored bid timer if the caller didn't send one.
      nextSettings = {
        ...args.settings,
        bidTimerSeconds:
          args.settings.bidTimerSeconds ??
          tournament.settings.bidTimerSeconds ??
          DEFAULT_BID_TIMER_SECONDS,
        footerText,
        bidMode,
        categories,
        incrementSlabs,
        presentationOrder:
          args.settings.presentationOrder ??
          tournament.settings.presentationOrder,
        squadRules,
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
                teamPurseTotal(args.settings!.basePurse, team) -
                  team.purseSpent,
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

    // Base prices (tournament or category) feed minPendingBasePrice, the
    // squad reserve. Cheap no-op when nothing count-relevant changed.
    if (nextSettings) await syncTournamentAuctionCounts(ctx, id);

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
    const admin = await requireAdmin(ctx);

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

    // Audit before deleting (the log row outlives the tournament).
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "delete_tournament",
      targetType: "tournament",
      targetId: args.id,
      previousData: {
        name: tournament.name,
        teams: teams.length,
        players: players.length,
        auctionRooms: auctionRooms.length,
      },
      tournamentId: args.id,
    });

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
