import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import {
  isTournamentStaff,
  logAdminAction,
  OWNER_ONLY,
  requireTournamentRole,
} from "./auth";
import { assertTeamCapacity } from "./plans";
import { syncTournamentAuctionCounts } from "./auctionCounts";
import { deleteTeamMembershipData } from "./members";
import { Doc, Id } from "./_generated/dataModel";
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

type NewTeamFields = {
  name: string;
  ownerName: string;
  sponsorName?: string;
  logoUrl?: string;
  colorPrimary: string;
  colorSecondary: string;
  captainPlayerId?: Id<"players">;
  captainName?: string;
  captainPhotoUrl?: string;
  captainAge?: number;
  captainRole?: Doc<"teams">["captainRole"];
  captainHand?: Doc<"teams">["captainHand"];
};

/**
 * Validate and insert one team with a full purse: the shared name rules, a
 * unique name, the plan's team limit and a free captain. Callers check
 * access and write the audit row. Used by create and teamRequests:approve.
 */
export async function insertValidatedTeam(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  fields: NewTeamFields,
): Promise<Id<"teams">> {
  // Validation (shared with update — convex/validation.ts)
  const error =
    validateTeamName(fields.name) ?? validateOwnerName(fields.ownerName);
  if (error) throw new Error(error);

  // Check for duplicate team name in tournament
  const existingTeams = await ctx.db
    .query("teams")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournament._id))
    .collect();

  if (isDuplicateTeamName(existingTeams, fields.name)) {
    throw new Error(`Team "${fields.name}" already exists in this tournament`);
  }
  assertTeamCapacity(tournament, existingTeams.length);

  // Captain chosen from players: validate and derive display fields
  let captainFields = {
    captainName: fields.captainName,
    captainPhotoUrl: fields.captainPhotoUrl,
    captainAge: fields.captainAge,
    captainRole: fields.captainRole,
    captainHand: fields.captainHand,
  };
  if (fields.captainPlayerId) {
    const captain = await ctx.db.get(fields.captainPlayerId);
    if (!captain) throw new Error("Selected captain player not found");
    if (captain.tournamentId !== tournament._id) {
      throw new Error("Captain must be a player in this tournament");
    }
    if (existingTeams.some((t) => t.captainPlayerId === fields.captainPlayerId)) {
      throw new Error(`${captain.name} is already the captain of another team`);
    }
    captainFields = deriveCaptainFields(captain);
  }

  return await ctx.db.insert("teams", {
    tournamentId: tournament._id,
    name: fields.name,
    ownerName: fields.ownerName,
    sponsorName: fields.sponsorName,
    logoUrl: fields.logoUrl,
    colorPrimary: fields.colorPrimary,
    colorSecondary: fields.colorSecondary,
    captainPlayerId: fields.captainPlayerId,
    ...captainFields,
    purseRemaining: tournament.settings.basePurse,
    purseSpent: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
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
    const admin = await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);

    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) throw new Error("Tournament not found");
    const { tournamentId: _tournamentId, ...fields } = args;
    const teamId = await insertValidatedTeam(ctx, tournament, fields);

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "create_team",
      targetType: "team",
      targetId: teamId,
      newData: {
        name: args.name,
        ownerName: args.ownerName,
        captainPlayerId: args.captainPlayerId,
      },
      tournamentId: args.tournamentId,
    });

    return teamId;
  },
});

export const listByTournament = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) return [];

    // Deactivated tournaments are hidden from everyone but its staff.
    if (tournament.isActive === false && !(await isTournamentStaff(ctx, args.tournamentId))) {
      return [];
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

    // Phone numbers are for this tournament's staff; strip them for everyone else.
    const admin = await isTournamentStaff(ctx, team.tournamentId);

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
    const team = await ctx.db.get(args.id);
    if (!team) throw new Error("Team not found");
    const admin = await requireTournamentRole(ctx, team.tournamentId, OWNER_ONLY);

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

    const { updatedAt: _updatedAt, ...changed } = patch;
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "update_team",
      targetType: "team",
      targetId: id,
      previousData: Object.fromEntries(
        Object.keys(changed).map((k) => [k, team[k as keyof typeof team]]),
      ),
      newData: changed,
      tournamentId: team.tournamentId,
    });

    return { success: true };
  },
});

export const deleteTeam = mutation({
  args: { id: v.id("teams") },
  handler: async (ctx, args) => {
    const team = await ctx.db.get(args.id);
    if (!team) throw new Error("Team not found");
    const admin = await requireTournamentRole(ctx, team.tournamentId, OWNER_ONLY);

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

    // Owners, invite links and queued raises all belong to the team.
    await deleteTeamMembershipData(ctx, args.id);

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
