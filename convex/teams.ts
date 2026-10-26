import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, isAdmin, logAdminAction, requireAdmin } from "./auth";
import { syncTournamentAuctionCounts } from "./auctionCounts";
import { Doc } from "./_generated/dataModel";
import { toPublicPlayer } from "./projections";
import { validateOwnerName, validateTeamName } from "./validation";

/**
 * Denormalize captain display fields from a player doc so existing UI and
 * PDF exports keep working unchanged when the captain is picked from players.
 */
function deriveCaptainFields(player: Doc<"players">) {
  const primaryRole = Array.isArray(player.role) ? player.role[0] : player.role;
  let captainRole: "Batter" | "Bowler" | "All-Rounder" | undefined;
  if (
    primaryRole === "Batter" ||
    primaryRole === "Bowler" ||
    primaryRole === "All-Rounder"
  ) {
    captainRole = primaryRole;
  } else if (primaryRole === "All Rounder") {
    captainRole = "All-Rounder";
  }
  // Other roles (e.g. Wicket Keeper) have no captainRole equivalent
  return {
    captainName: player.name,
    captainPhotoUrl: player.photoUrl,
    captainAge: player.age,
    captainRole,
    captainHand: player.battingBowlingHand.includes("Right")
      ? ("Right" as const)
      : ("Left" as const),
  };
}

/** Team names are unique per tournament, ignoring case and outer spaces. */
function isDuplicateTeamName(
  teams: Doc<"teams">[],
  name: string,
  exceptId?: Doc<"teams">["_id"],
): boolean {
  const wanted = name.trim().toLowerCase();
  return teams.some(
    (t) => t._id !== exceptId && t.name.trim().toLowerCase() === wanted,
  );
}

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
    captainPlayerId: v.optional(v.id("players")),
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

    // Validation (shared with update — convex/validation.ts)
    const error =
      validateTeamName(args.name) ?? validateOwnerName(args.ownerName);
    if (error) throw new Error(error);

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

    if (isDuplicateTeamName(existingTeams, args.name)) {
      throw new Error(`Team "${args.name}" already exists in this tournament`);
    }

    // Captain chosen from players: validate and derive display fields
    let captainFields = {
      captainName: args.captainName,
      captainPhotoUrl: args.captainPhotoUrl,
      captainAge: args.captainAge,
      captainRole: args.captainRole,
      captainHand: args.captainHand,
    };
    if (args.captainPlayerId) {
      const captain = await ctx.db.get(args.captainPlayerId);
      if (!captain) throw new Error("Selected captain player not found");
      if (captain.tournamentId !== args.tournamentId) {
        throw new Error("Captain must be a player in this tournament");
      }
      if (
        existingTeams.some((t) => t.captainPlayerId === args.captainPlayerId)
      ) {
        throw new Error(
          `${captain.name} is already the captain of another team`,
        );
      }
      captainFields = deriveCaptainFields(captain);
    }

    const teamId = await ctx.db.insert("teams", {
      tournamentId: args.tournamentId,
      name: args.name,
      ownerName: args.ownerName,
      sponsorName: args.sponsorName,
      logoUrl: args.logoUrl,
      colorPrimary: args.colorPrimary,
      colorSecondary: args.colorSecondary,
      captainPlayerId: args.captainPlayerId,
      ...captainFields,
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

    // Deactivated tournaments are hidden from non-admins even via direct links.
    if (tournament.isActive === false) {
      const user = await getCurrentUser(ctx);
      if (user?.role !== "admin") return [];
    }

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

    // Phone numbers are admin-only; strip them for everyone else.
    const admin = await isAdmin(ctx);

    return {
      ...team,
      players: admin ? players : players.map(toPublicPlayer),
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
    // null explicitly clears the player link; undefined leaves it unchanged
    captainPlayerId: v.optional(v.union(v.id("players"), v.null())),
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

    const fieldError =
      (args.name !== undefined ? validateTeamName(args.name) : null) ??
      (args.ownerName !== undefined ? validateOwnerName(args.ownerName) : null);
    if (fieldError) throw new Error(fieldError);

    const { id, captainPlayerId, ...updates } = args;
    const patch: Partial<Doc<"teams">> = {
      ...updates,
      updatedAt: Date.now(),
    };

    const otherTeams =
      args.name !== undefined || captainPlayerId
        ? await ctx.db
            .query("teams")
            .withIndex("by_tournament", (q) =>
              q.eq("tournamentId", team.tournamentId),
            )
            .collect()
        : [];

    if (
      args.name !== undefined &&
      args.name.trim().toLowerCase() !== team.name.trim().toLowerCase() &&
      isDuplicateTeamName(otherTeams, args.name, team._id)
    ) {
      throw new Error(`Team "${args.name}" already exists in this tournament`);
    }

    if (captainPlayerId === null) {
      // Explicitly unlink the player; manual captain fields (if any) still apply
      patch.captainPlayerId = undefined;
    } else if (captainPlayerId !== undefined) {
      const captain = await ctx.db.get(captainPlayerId);
      if (!captain) throw new Error("Selected captain player not found");
      if (captain.tournamentId !== team.tournamentId) {
        throw new Error("Captain must be a player in this tournament");
      }
      if (
        otherTeams.some(
          (t) => t._id !== team._id && t.captainPlayerId === captainPlayerId,
        )
      ) {
        throw new Error(
          `${captain.name} is already the captain of another team`,
        );
      }
      patch.captainPlayerId = captainPlayerId;
      Object.assign(patch, deriveCaptainFields(captain));
    }

    await ctx.db.patch(id, patch);

    return { success: true };
  },
});

export const deleteTeam = mutation({
  args: { id: v.id("teams") },
  handler: async (ctx, args) => {
    // Admin only
    const admin = await requireAdmin(ctx);

    const team = await ctx.db.get(args.id);
    if (!team) throw new Error("Team not found");

    // Check if tournament exists
    const tournament = await ctx.db.get(team.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Cannot delete from completed tournament
    if (tournament.status === "completed") {
      throw new Error("Cannot delete team after tournament is completed");
    }

    // Deleting a team mid-auction can corrupt in-flight state: if this team
    // holds the current leading bid, finalizePlayerSale would later fail
    // trying to resolve a winning team that no longer exists, and releasing
    // this team's sold players back to "pending" would desync live viewers'
    // stats/team lists in real time. A paused auction still has a player on
    // the block, so require the auction be stopped (waiting/completed) first.
    const rooms = await ctx.db
      .query("auctionRooms")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", team.tournamentId))
      .collect();
    if (rooms.some((room) => room.status === "live" || room.status === "paused")) {
      throw new Error(
        "Cannot delete a team while the auction is live or paused — complete or restart the auction first",
      );
    }

    // A locked group draw is final; an unlocked one is reset so it can be
    // re-drawn without a hole where this team was.
    const draw = await ctx.db
      .query("groupDraws")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", team.tournamentId))
      .first();
    if (draw && draw.assignments.some((a) => a.teamId === args.id)) {
      if (draw.status === "locked") {
        throw new Error(
          "Group draw is locked — reset it before deleting a team",
        );
      }
      await ctx.db.delete(draw._id);
    }

    // liveBids has no by_team index; scan each room's bids and drop this team's.
    for (const room of rooms) {
      const roomBids = await ctx.db
        .query("liveBids")
        .withIndex("by_room", (q) => q.eq("auctionRoomId", room._id))
        .collect();
      await Promise.all(
        roomBids
          .filter((bid) => bid.teamId === args.id)
          .map((bid) => ctx.db.delete(bid._id)),
      );
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

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "delete_team",
      targetType: "team",
      targetId: args.id,
      previousData: {
        name: team.name,
        purseRemaining: team.purseRemaining,
        purseSpent: team.purseSpent,
        releasedPlayerIds: players.map((p) => p._id),
      },
      tournamentId: team.tournamentId,
    });

    // Released players went back to "pending" — refresh denormalized counts.
    await syncTournamentAuctionCounts(ctx, team.tournamentId);

    return { success: true, releasedPlayers: players.length };
  },
});
