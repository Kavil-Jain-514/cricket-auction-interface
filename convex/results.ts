// convex/results.ts
// Auction results: the public results page and the admin .xlsx export.
//
// Final truth (who bought whom, at what price) is read from players and teams,
// never from the archived `bids` rows (G16). Admin corrections (reassign,
// updateSoldPrice, updatePlayerStatus) patch players and teams and are kept in
// auditLogs; `bids` and `auctionEvents` stay an append-only record of what
// happened on the floor, so rewriting them would lose that history. The export
// therefore takes only timing (sale order, time, bid count) from the
// `player_sold` events and flags rows that changed after the sale.
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { OWNER_ONLY, requireTournamentRole } from "./auth";
import { effectiveBasePrice } from "./bidRules";

const TOP_BUYS = 5;

/**
 * PUBLIC, identity-free (shared by every viewer of /results/<id>): squads by
 * team, top buys and spend. Null unless the tournament is completed and
 * active, for everyone. Never returns phone numbers.
 */
export const getPublicResults = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (
      !tournament ||
      tournament.status !== "completed" ||
      tournament.isActive === false
    ) {
      return null;
    }

    const [teams, players] = await Promise.all([
      ctx.db
        .query("teams")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect(),
      ctx.db
        .query("players")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect(),
    ]);
    const playersById = new Map(players.map((p) => [p._id, p]));
    const captainIds = new Set(teams.flatMap((t) => (t.captainPlayerId ? [t.captainPlayerId] : [])));

    // Explicit public projection: never spread a player doc (phoneNumber).
    const publicPlayer = (p: Doc<"players">) => ({
      _id: p._id,
      name: p.name,
      role: p.role,
      photoUrl: p.photoUrl,
      categoryId: p.categoryId,
      soldPrice: p.soldPrice ?? 0,
      teamId: p.teamId,
    });

    const sold = players
      .filter((p) => p.auctionStatus === "sold" && p.teamId && !captainIds.has(p._id))
      .map(publicPlayer)
      .sort((a, b) => b.soldPrice - a.soldPrice);

    return {
      tournament: {
        _id: tournament._id,
        name: tournament.name,
        logoUrl: tournament.logoUrl,
        basePurse: tournament.settings.basePurse,
        completedAt: tournament.updatedAt,
      },
      categories: tournament.settings.categories ?? [],
      teams: teams.map((team) => {
        const captain = team.captainPlayerId ? playersById.get(team.captainPlayerId) : undefined;
        return {
          _id: team._id,
          name: team.name,
          logoUrl: team.logoUrl,
          colorPrimary: team.colorPrimary,
          purseSpent: team.purseSpent,
          purseRemaining: team.purseRemaining,
          captain: captain
            ? { name: captain.name, photoUrl: captain.photoUrl }
            : team.captainName
              ? { name: team.captainName, photoUrl: team.captainPhotoUrl }
              : null,
          players: sold.filter((p) => p.teamId === team._id),
        };
      }),
      topBuys: sold.slice(0, TOP_BUYS),
      totals: {
        sold: sold.length,
        unsold: players.filter(
          (p) =>
            (p.auctionStatus === "unsold" || p.auctionStatus === "final_unsold") &&
            !captainIds.has(p._id),
        ).length,
        spent: sold.reduce((sum, p) => sum + p.soldPrice, 0),
      },
    };
  },
});

/**
 * ADMIN-ONLY data for the results workbook (lib/resultsWorkbook.ts builds the
 * sheets). Phone numbers are included only when `includeContacts` is set.
 */
export const getResultsExport = query({
  args: { tournamentId: v.id("tournaments"), includeContacts: v.boolean() },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) throw new Error("Tournament not found");
    await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);

    const [teams, players, rooms] = await Promise.all([
      ctx.db
        .query("teams")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect(),
      ctx.db
        .query("players")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect(),
      ctx.db
        .query("auctionRooms")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect(),
    ]);

    // Timing only (see the file comment): every player_sold event, oldest first.
    const events = (
      await Promise.all(
        rooms.map((room) =>
          ctx.db
            .query("auctionEvents")
            .withIndex("by_room_timestamp", (q) => q.eq("auctionRoomId", room._id))
            .collect(),
        ),
      )
    )
      .flat()
      .filter((e) => e.type === "player_sold")
      .sort((a, b) => a.timestamp - b.timestamp);

    const teamName = new Map(teams.map((t) => [t._id, t.name]));

    return {
      tournament: { name: tournament.name, basePurse: tournament.settings.basePurse },
      categories: tournament.settings.categories ?? [],
      teams: teams.map((t) => ({
        _id: t._id,
        name: t.name,
        purseSpent: t.purseSpent,
        purseRemaining: t.purseRemaining,
        purseAdjustment: t.purseAdjustment,
        captainPlayerId: t.captainPlayerId,
      })),
      players: players.map((p) => ({
        _id: p._id,
        name: p.name,
        role: p.role,
        categoryId: p.categoryId,
        auctionStatus: p.auctionStatus,
        teamId: p.teamId,
        soldPrice: p.soldPrice,
        basePrice: effectiveBasePrice(p, tournament.settings),
      })),
      sales: events.map((e) => {
        const data = e.data as {
          playerId: Id<"players">;
          teamId: Id<"teams">;
          amount: number;
          bidCount?: number;
        };
        return {
          playerId: data.playerId,
          teamId: data.teamId,
          amount: data.amount,
          timestamp: e.timestamp,
          bidCount: data.bidCount,
        };
      }),
      contacts: args.includeContacts
        ? players.map((p) => ({
            name: p.name,
            phoneNumber: p.phoneNumber ?? "",
            teamName: p.teamId ? (teamName.get(p.teamId) ?? "") : "",
            auctionStatus: p.auctionStatus,
          }))
        : null,
    };
  },
});
