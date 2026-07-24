import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, requireAdmin } from "./auth";
import { Doc } from "./_generated/dataModel";

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

    // Validation
    if (!args.name || args.name.trim().length < 2) {
      throw new Error("Team name must be at least 2 characters");
    }
    if (args.name.trim().length > 30) {
      throw new Error("Team name must be less than 30 characters");
    }
    if (!args.ownerName || args.ownerName.trim().length < 2) {
      throw new Error("Owner name must be at least 2 characters");
    }

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

    if (
      existingTeams.some(
        (t) => t.name.toLowerCase() === args.name.toLowerCase(),
      )
    ) {
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

    const { id, captainPlayerId, ...updates } = args;
    const patch: Partial<Doc<"teams">> = {
      ...updates,
      updatedAt: Date.now(),
    };

    if (captainPlayerId === null) {
      // Explicitly unlink the player; manual captain fields (if any) still apply
      patch.captainPlayerId = undefined;
    } else if (captainPlayerId !== undefined) {
      const captain = await ctx.db.get(captainPlayerId);
      if (!captain) throw new Error("Selected captain player not found");
      if (captain.tournamentId !== team.tournamentId) {
        throw new Error("Captain must be a player in this tournament");
      }
      const otherTeams = await ctx.db
        .query("teams")
        .withIndex("by_tournament", (q) =>
          q.eq("tournamentId", team.tournamentId),
        )
        .collect();
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
    await requireAdmin(ctx);

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
    // stats/team lists in real time. Require the auction be paused first.
    const liveRooms = await ctx.db
      .query("auctionRooms")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", team.tournamentId))
      .collect();
    if (liveRooms.some((room) => room.status === "live")) {
      throw new Error(
        "Cannot delete a team while the auction is live — pause or complete the auction first",
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
    return { success: true, releasedPlayers: players.length };
  },
});
