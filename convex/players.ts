import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { logAdminAction, requireAdmin } from "./auth";
import { syncTournamentAuctionCounts } from "./auctionCounts";
import { normalizePhone, validatePlayerFields } from "./validation";

// Shared validator for T-shirt size — reused across create, bulkImport, and update
const tshirtSizeValidator = v.optional(
  v.union(
    v.literal("XS"),
    v.literal("S"),
    v.literal("M"),
    v.literal("L"),
    v.literal("XL"),
    v.literal("XXL"),
    v.literal("3XL"),
    v.literal("4XL"),
  ),
);

/** Create a single player for a tournament. Auto-assigns the next sequential playerNumber. */
export const create = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.string(),
    age: v.number(),
    photoUrl: v.optional(v.string()),
    role: v.array(v.string()),
    battingBowlingHand: v.union(
      v.literal("Right-handed"),
      v.literal("Left-handed"),
    ),
    basePrice: v.optional(v.number()),
    jerseyNumber: v.optional(v.number()),
    jerseyName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    tshirtSize: tshirtSizeValidator,
  },
  handler: async (ctx, args) => {
    // Admin only
    const admin = await requireAdmin(ctx);

    // Verify tournament exists
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found");
    }

    // Validation (shared with update and bulkImport — convex/validation.ts)
    const { errors, phoneNumber } = validatePlayerFields(
      args,
      tournament.settings.basePurse,
    );
    if (errors.length > 0) throw new Error(errors[0].message);

    // Get the next player number for this tournament
    const existingPlayers = await ctx.db
      .query("players")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();

    const maxPlayerNumber = existingPlayers.reduce((max, player) => {
      return Math.max(max, player.playerNumber || 0);
    }, 0);
    const nextPlayerNumber = maxPlayerNumber + 1;

    const playerId = await ctx.db.insert("players", {
      tournamentId: args.tournamentId,
      name: args.name,
      phoneNumber,
      age: args.age,
      photoUrl: args.photoUrl,
      role: args.role,
      battingBowlingHand: args.battingBowlingHand,
      basePrice: args.basePrice,
      jerseyNumber: args.jerseyNumber,
      jerseyName: args.jerseyName,
      playerNumber: nextPlayerNumber,
      tshirtSize: args.tshirtSize,
      auctionStatus: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // New pending player — refresh denormalized counts / min pending base price.
    await syncTournamentAuctionCounts(ctx, args.tournamentId);

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "create_player",
      targetType: "player",
      targetId: playerId,
      newData: { name: args.name, basePrice: args.basePrice },
      tournamentId: args.tournamentId,
    });

    return playerId;
  },
});

/**
 * Bulk-import multiple players from a parsed Excel sheet.
 * Every row is validated first (field rules + duplicates of an existing or
 * earlier row by name + phone). If any row fails, nothing is inserted and the
 * row errors are returned so the UI can list them.
 * Player numbers continue from the current max to avoid conflicts.
 */
export const bulkImport = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    players: v.array(
      v.object({
        name: v.string(),
        age: v.number(),
        role: v.array(v.string()),
        battingBowlingHand: v.union(
          v.literal("Right-handed"),
          v.literal("Left-handed"),
        ),
        phoneNumber: v.optional(v.string()),
        photoUrl: v.optional(v.string()),
        basePrice: v.optional(v.number()),
        jerseyNumber: v.optional(v.number()),
        jerseyName: v.optional(v.string()),
        tshirtSize: tshirtSizeValidator,
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Admin only
    const admin = await requireAdmin(ctx);

    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const now = Date.now();

    // Get the current max player number for this tournament
    const existingPlayers = await ctx.db
      .query("players")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();

    // Duplicate key: same name (case-insensitive) + same normalised phone.
    const duplicateKey = (name: string, phone: string | undefined) =>
      `${name.trim().toLowerCase()}|${phone ?? ""}`;
    const seen = new Set(
      existingPlayers.map((p) => {
        // Legacy rows may hold an un-normalised phone; compare on digits.
        const phone = normalizePhone(p.phoneNumber);
        return duplicateKey(p.name, phone.ok ? phone.phone : p.phoneNumber);
      }),
    );

    const errors: { row: number; field: string; message: string }[] = [];
    const rows = args.players.map((player, row) => {
      const result = validatePlayerFields(
        player,
        tournament.settings.basePurse,
      );
      errors.push(...result.errors.map((e) => ({ row, ...e })));

      const key = duplicateKey(player.name, result.phoneNumber);
      if (seen.has(key)) {
        errors.push({
          row,
          field: "name",
          message: `Duplicate player "${player.name.trim()}" (same name and phone)`,
        });
      }
      seen.add(key);

      return { ...player, phoneNumber: result.phoneNumber };
    });

    if (errors.length > 0) {
      return { success: false as const, errors };
    }

    const maxPlayerNumber = existingPlayers.reduce((max, player) => {
      return Math.max(max, player.playerNumber || 0);
    }, 0);

    // Batch insert all players with incrementing player numbers
    const insertPromises = rows.map((player, index) =>
      ctx.db.insert("players", {
        tournamentId: args.tournamentId,
        name: player.name,
        phoneNumber: player.phoneNumber,
        age: player.age,
        photoUrl: player.photoUrl,
        role: player.role,
        battingBowlingHand: player.battingBowlingHand,
        basePrice: player.basePrice,
        jerseyNumber: player.jerseyNumber,
        jerseyName: player.jerseyName,
        playerNumber: maxPlayerNumber + index + 1,
        tshirtSize: player.tshirtSize,
        auctionStatus: "pending",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const playerIds = await Promise.all(insertPromises);

    // Bulk pending insert — refresh denormalized counts once for the batch.
    await syncTournamentAuctionCounts(ctx, args.tournamentId);

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "bulk_import_players",
      targetType: "tournament",
      targetId: args.tournamentId,
      newData: { count: playerIds.length },
      tournamentId: args.tournamentId,
    });

    return { success: true as const, count: playerIds.length, ids: playerIds };
  },
});

/**
 * List players for a tournament with optional status filter.
 * Uses the compound `by_tournament_status` index when filtering to avoid a full scan.
 * Phone numbers (PII) are stripped for non-admin viewers.
 */
export const listByTournament = query({
  args: {
    tournamentId: v.id("tournaments"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("sold"),
        v.literal("unsold"),
        v.literal("in_auction"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) return [];

    // Check if the current user is an admin to determine PII visibility
    const identity = await ctx.auth.getUserIdentity();
    let isAdminUser = false;
    if (identity?.email) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", identity.email!))
        .first();
      isAdminUser = user?.role === "admin";
    }

    // Deactivated tournaments are hidden from non-admins even via direct links.
    if (tournament.isActive === false && !isAdminUser) return [];

    // Use the compound index when filtering by status to avoid a full-collection scan.
    const players = args.status
      ? await ctx.db
          .query("players")
          .withIndex("by_tournament_status", (q) =>
            q
              .eq("tournamentId", args.tournamentId)
              .eq("auctionStatus", args.status!),
          )
          .collect()
      : await ctx.db
          .query("players")
          .withIndex("by_tournament", (q) =>
            q.eq("tournamentId", args.tournamentId),
          )
          .collect();

    // Map players to resolve basePrice fallback and strip PII for non-admins
    return players.map((p) => {
      const basePrice = p.basePrice ?? tournament.settings?.basePrice ?? 100000;
      if (isAdminUser) {
        return { ...p, basePrice };
      }
      // Strip phone number for non-admin viewers
      const { phoneNumber: _stripped, ...publicFields } = p;
      return { ...publicFields, basePrice };
    });
  },
});

/** Update player fields. Blocked for sold or in-auction players. */
export const update = mutation({
  args: {
    id: v.id("players"),
    name: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    age: v.optional(v.number()),
    photoUrl: v.optional(v.string()),
    role: v.optional(v.array(v.string())),
    battingBowlingHand: v.optional(
      v.union(v.literal("Right-handed"), v.literal("Left-handed")),
    ),
    basePrice: v.optional(v.number()),
    jerseyNumber: v.optional(v.number()),
    jerseyName: v.optional(v.string()),
    tshirtSize: tshirtSizeValidator,
  },
  handler: async (ctx, args) => {
    // Admin only
    const admin = await requireAdmin(ctx);

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

    const tournament = await ctx.db.get(player.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Validation (shared with create — convex/validation.ts)
    const { errors, phoneNumber } = validatePlayerFields(
      args,
      tournament.settings.basePurse,
    );
    if (errors.length > 0) throw new Error(errors[0].message);

    const { id, ...updates } = args;

    await ctx.db.patch(id, {
      ...updates,
      ...(args.phoneNumber !== undefined ? { phoneNumber } : {}),
      updatedAt: Date.now(),
    });

    // basePrice may have changed on a pending player — refresh min pending base
    // price (cheap no-op write when nothing count-relevant actually changed).
    await syncTournamentAuctionCounts(ctx, player.tournamentId);

    // Phone numbers are PII — record that they changed, not their values.
    const { phoneNumber: _phone, ...auditable } = updates;
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "update_player",
      targetType: "player",
      targetId: id,
      previousData: Object.fromEntries(
        Object.keys(auditable).map((k) => [k, player[k as keyof typeof player]]),
      ),
      newData: {
        ...auditable,
        ...(args.phoneNumber !== undefined ? { phoneNumberChanged: true } : {}),
      },
      tournamentId: player.tournamentId,
    });

    return { success: true };
  },
});

/** Delete a player. Cannot delete sold or in-auction players. */
export const deletePlayer = mutation({
  args: { id: v.id("players") },
  handler: async (ctx, args) => {
    // Admin only
    const admin = await requireAdmin(ctx);

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

    // Unlink from any team that had this player as captain (the denormalized
    // captain display fields are kept, matching manual-entry behavior)
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", player.tournamentId),
      )
      .collect();
    await Promise.all(
      teams
        .filter((t) => t.captainPlayerId === args.id)
        .map((t) =>
          ctx.db.patch(t._id, {
            captainPlayerId: undefined,
            updatedAt: Date.now(),
          }),
        ),
    );

    await ctx.db.delete(args.id);

    // Player removed from the pool — refresh denormalized counts.
    await syncTournamentAuctionCounts(ctx, player.tournamentId);

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "delete_player",
      targetType: "player",
      targetId: args.id,
      previousData: {
        name: player.name,
        auctionStatus: player.auctionStatus,
        playerNumber: player.playerNumber,
      },
      tournamentId: player.tournamentId,
    });

    return { success: true };
  },
});

/**
 * Delete all pending/unsold players for a tournament.
 * Sold and in-auction players are always skipped unless `includesSold` is true.
 */
export const deleteAllByTournament = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    includesSold: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Admin only
    const admin = await requireAdmin(ctx);

    const players = await ctx.db
      .query("players")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();

    // Captains are pre-assigned and never auctioned — every other bulk
    // player view/count in this app excludes them (see getAuctionRoster,
    // syncTournamentAuctionCounts). Bulk delete must match, or the
    // confirmation dialog's counts (which already exclude captains)
    // would understate what actually gets deleted.
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();
    const captainPlayerIds = new Set(
      teams.flatMap((t) => (t.captainPlayerId ? [t.captainPlayerId] : [])),
    );

    // Filter out sold players unless explicitly included, and always skip captains
    const playersToDelete = (
      args.includesSold
        ? players.filter((p) => p.auctionStatus !== "in_auction")
        : players.filter(
            (p) =>
              p.auctionStatus !== "sold" && p.auctionStatus !== "in_auction",
          )
    ).filter((p) => !captainPlayerIds.has(p._id));

    // Delete in parallel for performance
    await Promise.all(playersToDelete.map((p) => ctx.db.delete(p._id)));

    // Bulk removal — refresh denormalized counts once.
    await syncTournamentAuctionCounts(ctx, args.tournamentId);

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "delete_all_players",
      targetType: "tournament",
      targetId: args.tournamentId,
      previousData: {
        deletedCount: playersToDelete.length,
        includesSold: args.includesSold ?? false,
      },
      tournamentId: args.tournamentId,
    });

    return {
      success: true,
      deletedCount: playersToDelete.length,
      skippedCount: players.length - playersToDelete.length,
    };
  },
});
