import { v } from "convex/values";
import { mutation, MutationCtx, query } from "./_generated/server";
import {
  isTournamentStaff,
  logAdminAction,
  OWNER_ONLY,
  requireTournamentRole,
} from "./auth";
import { syncTournamentAuctionCounts } from "./auctionCounts";
import { normalizePhone, validatePlayerFields } from "./validation";
import { categoryFor, effectiveBasePrice } from "./bidRules";
import { assertPlayerCapacity } from "./plans";
import type { Doc, Id } from "./_generated/dataModel";

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

/** Error message when `categoryId` isn't one of the tournament's categories. */
function unknownCategoryError(
  categoryId: string | undefined,
  tournament: Doc<"tournaments">,
): string | null {
  if (categoryId === undefined) return null;
  return categoryFor(categoryId, tournament.settings.categories)
    ? null
    : "Unknown category — add it in Tournament Settings first";
}

/** Fields a new player is created with (players:create, registration approval). */
export type NewPlayerFields = {
  name: string;
  age: number;
  photoUrl?: string;
  role: string[];
  battingBowlingHand: "Right-handed" | "Left-handed";
  basePrice?: number;
  categoryId?: string;
  jerseyNumber?: number;
  jerseyName?: string;
  phoneNumber?: string;
  tshirtSize?: Doc<"players">["tshirtSize"];
  consentWhatsApp?: boolean;
};

/**
 * Validate and insert one pending player with the next player number: the
 * shared rules (convex/validation.ts), a known category and the plan's player
 * limit. Callers check access, resync counts and write the audit row.
 */
export async function insertValidatedPlayer(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  fields: NewPlayerFields,
): Promise<Id<"players">> {
  const { errors, phoneNumber } = validatePlayerFields(fields, tournament.settings.basePurse);
  if (errors.length > 0) throw new Error(errors[0].message);
  const categoryError = unknownCategoryError(fields.categoryId, tournament);
  if (categoryError) throw new Error(categoryError);

  const existingPlayers = await ctx.db
    .query("players")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournament._id))
    .collect();
  assertPlayerCapacity(tournament, existingPlayers.length, 1);
  const nextPlayerNumber = existingPlayers.reduce((max, p) => Math.max(max, p.playerNumber || 0), 0) + 1;

  return await ctx.db.insert("players", {
    tournamentId: tournament._id,
    name: fields.name,
    phoneNumber,
    age: fields.age,
    photoUrl: fields.photoUrl,
    role: fields.role,
    battingBowlingHand: fields.battingBowlingHand,
    basePrice: fields.basePrice,
    categoryId: fields.categoryId,
    jerseyNumber: fields.jerseyNumber,
    jerseyName: fields.jerseyName,
    playerNumber: nextPlayerNumber,
    tshirtSize: fields.tshirtSize,
    consentWhatsApp: fields.consentWhatsApp,
    auctionStatus: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

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
    categoryId: v.optional(v.string()),
    jerseyNumber: v.optional(v.number()),
    jerseyName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    tshirtSize: tshirtSizeValidator,
  },
  handler: async (ctx, args) => {
    // Verify tournament exists
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found");
    }
    const admin = await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);

    const playerId = await insertValidatedPlayer(ctx, tournament, args);

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
        categoryId: v.optional(v.string()),
        jerseyNumber: v.optional(v.number()),
        jerseyName: v.optional(v.string()),
        tshirtSize: tshirtSizeValidator,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) throw new Error("Tournament not found");
    const admin = await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);

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
      const categoryError = unknownCategoryError(player.categoryId, tournament);
      if (categoryError) {
        errors.push({ row, field: "categoryId", message: categoryError });
      }

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
    // All or nothing: a batch that would overflow the plan imports nobody.
    assertPlayerCapacity(tournament, existingPlayers.length, rows.length);

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
        categoryId: player.categoryId,
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

    // Phone numbers (PII) are for this tournament's staff (or a super-admin).
    const isAdminUser = await isTournamentStaff(ctx, args.tournamentId);

    // Deactivated tournaments are hidden from everyone but its staff.
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

    // Map players to resolve basePrice (player → category → tournament) and
    // strip PII for non-admins. basePriceOverride is the player's own price,
    // so edit forms don't pin the inherited value as an override.
    return players.map((p) => {
      const basePrice = effectiveBasePrice(p, tournament.settings);
      const basePriceOverride = p.basePrice;
      if (isAdminUser) {
        return { ...p, basePrice, basePriceOverride };
      }
      // Strip phone number for non-admin viewers
      const { phoneNumber: _stripped, ...publicFields } = p;
      return { ...publicFields, basePrice, basePriceOverride };
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
    // null clears the override, so the category / tournament price applies.
    basePrice: v.optional(v.union(v.number(), v.null())),
    // null removes the player from their category.
    categoryId: v.optional(v.union(v.string(), v.null())),
    jerseyNumber: v.optional(v.number()),
    jerseyName: v.optional(v.string()),
    tshirtSize: tshirtSizeValidator,
  },
  handler: async (ctx, args) => {
    const player = await ctx.db.get(args.id);
    if (!player) throw new Error("Player not found");
    const admin = await requireTournamentRole(ctx, player.tournamentId, OWNER_ONLY);

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
      { ...args, basePrice: args.basePrice ?? undefined },
      tournament.settings.basePurse,
    );
    if (errors.length > 0) throw new Error(errors[0].message);
    const categoryError = unknownCategoryError(
      args.categoryId ?? undefined,
      tournament,
    );
    if (categoryError) throw new Error(categoryError);

    const { id, basePrice, categoryId, ...rest } = args;
    // null → clear the field (patching undefined removes it).
    const updates = {
      ...rest,
      ...(basePrice !== undefined ? { basePrice: basePrice ?? undefined } : {}),
      ...(categoryId !== undefined
        ? { categoryId: categoryId ?? undefined }
        : {}),
    };

    await ctx.db.patch(id, {
      ...updates,
      ...(args.phoneNumber !== undefined ? { phoneNumber } : {}),
      updatedAt: Date.now(),
    });

    // basePrice or category may have changed on a pending player — refresh min
    // pending base price (cheap no-op write when nothing count-relevant changed).
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
    const player = await ctx.db.get(args.id);
    if (!player) throw new Error("Player not found");
    const admin = await requireTournamentRole(ctx, player.tournamentId, OWNER_ONLY);

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
    const admin = await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);

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

    // Sold players take their price back to their team, in this same
    // transaction, so purseSpent stays the sum of the squad's prices.
    const refunds = new Map<Id<"teams">, number>();
    for (const p of playersToDelete) {
      if (p.auctionStatus === "sold" && p.teamId && p.soldPrice) {
        refunds.set(p.teamId, (refunds.get(p.teamId) ?? 0) + p.soldPrice);
      }
    }
    const now = Date.now();
    await Promise.all(
      teams
        .filter((team) => refunds.has(team._id))
        .map((team) =>
          ctx.db.patch(team._id, {
            purseRemaining: team.purseRemaining + refunds.get(team._id)!,
            purseSpent: team.purseSpent - refunds.get(team._id)!,
            updatedAt: now,
          }),
        ),
    );

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
      newData: { refunds: Object.fromEntries(refunds) },
      tournamentId: args.tournamentId,
    });

    return {
      success: true,
      deletedCount: playersToDelete.length,
      skippedCount: players.length - playersToDelete.length,
    };
  },
});
