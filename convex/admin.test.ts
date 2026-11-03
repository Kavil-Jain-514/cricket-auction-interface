/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { syncTournamentAuctionCounts } from "./auctionCounts";

// Discover the Convex function modules for the test runtime (see
// auctions.test.ts for why _generated must stay included).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };

const BASE_PURSE = 1_000_000;

/**
 * Seed an admin user + tournament with two teams and an auction room in the
 * given status. Data is inserted directly so each test starts deterministic.
 */
async function setup(
  t: ReturnType<typeof convexTest>,
  opts: { roomStatus?: Doc<"auctionRooms">["status"] } = {},
) {
  const { roomStatus = "live" } = opts;
  return await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", {
      email: ADMIN_IDENTITY.email,
      role: "admin",
      createdAt: now,
    });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Test Cup",
      createdBy: adminId,
      status: "active",
      settings: {
        basePurse: BASE_PURSE,
        minBidIncrement: 25_000,
        bidTimerSeconds: 30,
        maxPlayersPerTeam: 5,
        basePrice: 100_000,
      },
      createdAt: now,
      updatedAt: now,
    });
    const mkTeam = (name: string) =>
      ctx.db.insert("teams", {
        tournamentId,
        name,
        ownerName: "owner",
        purseRemaining: BASE_PURSE,
        purseSpent: 0,
        colorPrimary: "#111111",
        colorSecondary: "#222222",
        createdAt: now,
        updatedAt: now,
      });
    const teamA = await mkTeam("Team A");
    const teamB = await mkTeam("Team B");
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room 1",
      status: roomStatus,
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    return { adminId, tournamentId, teamA, teamB, roomId };
  });
}

/**
 * Insert a player. A sold player is debited from its team's purse so the seed
 * already satisfies the money invariants.
 */
async function insertPlayer(
  t: ReturnType<typeof convexTest>,
  args: {
    tournamentId: Id<"tournaments">;
    auctionStatus: Doc<"players">["auctionStatus"];
    teamId?: Id<"teams">;
    soldPrice?: number;
  },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const playerId = await ctx.db.insert("players", {
      tournamentId: args.tournamentId,
      name: "Player",
      age: 25,
      role: "Batter",
      battingBowlingHand: "Right-handed",
      auctionStatus: args.auctionStatus,
      teamId: args.teamId,
      soldPrice: args.soldPrice,
      createdAt: now,
      updatedAt: now,
    });
    if (args.teamId && args.soldPrice) {
      const team = (await ctx.db.get(args.teamId))!;
      await ctx.db.patch(args.teamId, {
        purseRemaining: team.purseRemaining - args.soldPrice,
        purseSpent: team.purseSpent + args.soldPrice,
      });
    }
    await syncTournamentAuctionCounts(ctx, args.tournamentId);
    return playerId;
  });
}

/** Assert both CLAUDE.md money invariants for every team in the tournament. */
async function expectInvariants(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  await t.run(async (ctx) => {
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
      .collect();
    for (const team of teams) {
      expect(team.purseRemaining + team.purseSpent).toBe(BASE_PURSE);
      const players = await ctx.db
        .query("players")
        .withIndex("by_team", (q) => q.eq("teamId", team._id))
        .collect();
      const spent = players
        .filter((p) => p.auctionStatus === "sold")
        .reduce((sum, p) => sum + (p.soldPrice ?? 0), 0);
      expect(team.purseSpent).toBe(spent);
    }
  });
}

async function getTeam(t: ReturnType<typeof convexTest>, id: Id<"teams">) {
  return await t.run((ctx) => ctx.db.get(id));
}

describe("admin corrections — money safety", () => {
  test("reassigning a player to their current team leaves the purse unchanged", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA } = await setup(t);
    const playerId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "sold",
      teamId: teamA,
      soldPrice: 300_000,
    });

    await asAdmin.mutation(api.admin.reassignPlayer, {
      playerId,
      newTeamId: teamA,
    });

    const team = await getTeam(t, teamA);
    expect(team?.purseRemaining).toBe(700_000);
    expect(team?.purseSpent).toBe(300_000);
    await expectInvariants(t, tournamentId);
  });

  test("same-team reassign with a new price behaves like updateSoldPrice", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA } = await setup(t);
    const playerId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "sold",
      teamId: teamA,
      soldPrice: 300_000,
    });

    await asAdmin.mutation(api.admin.reassignPlayer, {
      playerId,
      newTeamId: teamA,
      newSoldPrice: 400_000,
    });

    const team = await getTeam(t, teamA);
    expect(team?.purseRemaining).toBe(600_000);
    expect(team?.purseSpent).toBe(400_000);
    await expectInvariants(t, tournamentId);
  });

  test("reassigning to another team refunds the old team and debits the new one", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA, teamB } = await setup(t);
    const playerId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "sold",
      teamId: teamA,
      soldPrice: 300_000,
    });

    await asAdmin.mutation(api.admin.reassignPlayer, {
      playerId,
      newTeamId: teamB,
    });

    expect((await getTeam(t, teamA))?.purseSpent).toBe(0);
    expect((await getTeam(t, teamB))?.purseSpent).toBe(300_000);
    await expectInvariants(t, tournamentId);
  });

  test("reassigning to a team from another tournament is rejected", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA } = await setup(t);
    const other = await setup(t);
    const playerId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "sold",
      teamId: teamA,
      soldPrice: 300_000,
    });

    await expect(
      asAdmin.mutation(api.admin.reassignPlayer, {
        playerId,
        newTeamId: other.teamA,
      }),
    ).rejects.toThrow(/tournament/i);
    await expectInvariants(t, tournamentId);
  });

  test("sold→sold status change refunds the old team and debits the new team exactly once", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA, teamB } = await setup(t);
    const playerId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "sold",
      teamId: teamA,
      soldPrice: 300_000,
    });

    await asAdmin.mutation(api.admin.updatePlayerStatus, {
      playerId,
      newStatus: "sold",
      teamId: teamB,
      soldPrice: 200_000,
    });

    const a = await getTeam(t, teamA);
    const b = await getTeam(t, teamB);
    expect(a?.purseRemaining).toBe(BASE_PURSE);
    expect(a?.purseSpent).toBe(0);
    expect(b?.purseRemaining).toBe(800_000);
    expect(b?.purseSpent).toBe(200_000);
    await expectInvariants(t, tournamentId);
  });

  test("sold→sold status change on the same team re-prices without double-counting", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA } = await setup(t);
    const playerId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "sold",
      teamId: teamA,
      soldPrice: 300_000,
    });

    await asAdmin.mutation(api.admin.updatePlayerStatus, {
      playerId,
      newStatus: "sold",
      teamId: teamA,
      soldPrice: 250_000,
    });

    expect((await getTeam(t, teamA))?.purseSpent).toBe(250_000);
    await expectInvariants(t, tournamentId);
  });

  test("updateSoldPrice and sold→unsold keep the invariants", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA } = await setup(t);
    const playerId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "sold",
      teamId: teamA,
      soldPrice: 300_000,
    });

    await asAdmin.mutation(api.admin.updateSoldPrice, {
      playerId,
      newSoldPrice: 450_000,
    });
    await expectInvariants(t, tournamentId);

    await asAdmin.mutation(api.admin.updatePlayerStatus, {
      playerId,
      newStatus: "unsold",
    });
    await expectInvariants(t, tournamentId);
    expect((await getTeam(t, teamA))?.purseSpent).toBe(0);
  });
});

describe("admin corrections — guards", () => {
  test("corrections on an in_auction player are rejected", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA } = await setup(t);
    const playerId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "in_auction",
    });

    await expect(
      asAdmin.mutation(api.admin.reassignPlayer, {
        playerId,
        newTeamId: teamA,
        newSoldPrice: 200_000,
      }),
    ).rejects.toThrow(/on the block/i);
    await expect(
      asAdmin.mutation(api.admin.updateSoldPrice, {
        playerId,
        newSoldPrice: 200_000,
      }),
    ).rejects.toThrow(/on the block/i);
    await expect(
      asAdmin.mutation(api.admin.updatePlayerStatus, {
        playerId,
        newStatus: "sold",
        teamId: teamA,
        soldPrice: 200_000,
      }),
    ).rejects.toThrow(/on the block/i);
    await expectInvariants(t, tournamentId);
  });

  test("corrections on a team captain are rejected", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA, teamB } = await setup(t);
    const captainId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "pending",
    });
    await t.run((ctx) => ctx.db.patch(teamA, { captainPlayerId: captainId }));

    await expect(
      asAdmin.mutation(api.admin.reassignPlayer, {
        playerId: captainId,
        newTeamId: teamB,
        newSoldPrice: 200_000,
      }),
    ).rejects.toThrow(/captain/i);
    await expect(
      asAdmin.mutation(api.admin.updateSoldPrice, {
        playerId: captainId,
        newSoldPrice: 200_000,
      }),
    ).rejects.toThrow(/captain/i);
    await expect(
      asAdmin.mutation(api.admin.updatePlayerStatus, {
        playerId: captainId,
        newStatus: "sold",
        teamId: teamB,
        soldPrice: 200_000,
      }),
    ).rejects.toThrow(/captain/i);
    await expectInvariants(t, tournamentId);
  });

  test("reassigning an unsold player resyncs the tournament counts", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA } = await setup(t);
    const playerId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "unsold",
    });

    await asAdmin.mutation(api.admin.reassignPlayer, {
      playerId,
      newTeamId: teamA,
      newSoldPrice: 200_000,
    });

    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.auctionCounts).toMatchObject({ sold: 1, unsold: 0 });
    await expectInvariants(t, tournamentId);
  });
});

describe("deleteTeam", () => {
  test("is rejected while the auction is paused", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { teamA } = await setup(t, { roomStatus: "paused" });

    await expect(
      asAdmin.mutation(api.teams.deleteTeam, { id: teamA }),
    ).rejects.toThrow(/pause|live|running/i);
    expect(await getTeam(t, teamA)).not.toBeNull();
  });

  test("removes the team's live bids, resets an unlocked draw and resyncs counts", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { adminId, tournamentId, teamA, teamB, roomId } = await setup(t, {
      roomStatus: "waiting",
    });
    await insertPlayer(t, {
      tournamentId,
      auctionStatus: "sold",
      teamId: teamA,
      soldPrice: 300_000,
    });
    const bidPlayerId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "pending",
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("liveBids", {
        auctionRoomId: roomId,
        playerId: bidPlayerId,
        teamId: teamA,
        amount: 100_000,
        timestamp: now,
      });
      await ctx.db.insert("liveBids", {
        auctionRoomId: roomId,
        playerId: bidPlayerId,
        teamId: teamB,
        amount: 125_000,
        timestamp: now + 1,
      });
      await ctx.db.insert("groupDraws", {
        tournamentId,
        numGroups: 1,
        status: "drawn",
        assignments: [
          { teamId: teamA, group: "A", slot: 1, slotLabel: "A1" },
          { teamId: teamB, group: "A", slot: 2, slotLabel: "A2" },
        ],
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await asAdmin.mutation(api.teams.deleteTeam, { id: teamA });

    await t.run(async (ctx) => {
      const bids = await ctx.db.query("liveBids").collect();
      expect(bids.map((b) => b.teamId)).toEqual([teamB]);
      const draw = await ctx.db
        .query("groupDraws")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
        .first();
      expect(draw).toBeNull();
      const tournament = await ctx.db.get(tournamentId);
      expect(tournament?.auctionCounts).toMatchObject({ sold: 0, pending: 2 });
    });
    await expectInvariants(t, tournamentId);
  });

  test("is rejected when the team is in a locked group draw", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { adminId, tournamentId, teamA, teamB } = await setup(t, {
      roomStatus: "waiting",
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("groupDraws", {
        tournamentId,
        numGroups: 1,
        status: "locked",
        assignments: [
          { teamId: teamA, group: "A", slot: 1, slotLabel: "A1" },
          { teamId: teamB, group: "A", slot: 2, slotLabel: "A2" },
        ],
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      asAdmin.mutation(api.teams.deleteTeam, { id: teamA }),
    ).rejects.toThrow(/locked/i);
    expect(await getTeam(t, teamA)).not.toBeNull();
  });
});

describe("deleteTournament", () => {
  test("removes the tournament's group draw", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { adminId, tournamentId, teamA, teamB } = await setup(t, {
      roomStatus: "waiting",
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("groupDraws", {
        tournamentId,
        numGroups: 1,
        status: "locked",
        assignments: [
          { teamId: teamA, group: "A", slot: 1, slotLabel: "A1" },
          { teamId: teamB, group: "A", slot: 2, slotLabel: "A2" },
        ],
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await asAdmin.mutation(api.tournaments.deleteTournament, {
      id: tournamentId,
      confirmName: "Test Cup",
    });

    const draws = await t.run((ctx) => ctx.db.query("groupDraws").collect());
    expect(draws).toHaveLength(0);
  });
});
