/// <reference types="vite/client" />
// Purse invariants on the less common money paths (AUDIT 2026-11 DATA-001,
// DATA-002): snapshot restore, ending a rehearsal, and changing the base purse.
// For every team, purseRemaining + purseSpent == basePurse + purseAdjustment
// and purseSpent == the sum of its sold players' prices; getReconciliation
// checks both.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { takeSnapshot } from "./snapshots";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };

/** Admin, a tournament with one team and one pending player, and a room in `roomStatus`. */
async function setup(t: ReturnType<typeof convexTest>, roomStatus: "waiting" | "live" = "waiting") {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", { email: ADMIN_IDENTITY.email, role: "admin", createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Purse Cup",
      createdBy: adminId,
      status: "active",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, bidTimerSeconds: 30, maxPlayersPerTeam: 3, basePrice: 100_000 },
      createdAt: now,
      updatedAt: now,
    });
    const teamA = await ctx.db.insert("teams", {
      tournamentId,
      name: "Team A",
      ownerName: "owner",
      purseRemaining: 1_000_000,
      purseSpent: 0,
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      createdAt: now,
      updatedAt: now,
    });
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room",
      status: roomStatus,
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    return { adminId, tournamentId, teamA, roomId };
  });
}

async function addPlayer(t: ReturnType<typeof convexTest>, tournamentId: Id<"tournaments">, name: string) {
  return await t.run((ctx) =>
    ctx.db.insert("players", {
      tournamentId,
      name,
      age: 30,
      role: ["Batter"],
      battingBowlingHand: "Right-handed",
      auctionStatus: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

async function reconcile(t: ReturnType<typeof convexTest>, tournamentId: Id<"tournaments">) {
  return await t.withIdentity(ADMIN_IDENTITY).query(api.auctions.getReconciliation, { tournamentId });
}

describe("snapshot restore keeps every purse consistent (DATA-001)", () => {
  test("a team created after the snapshot gets its money back when its players are reset", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { adminId, tournamentId } = await setup(t);
    const playerId = await addPlayer(t, tournamentId, "Virat");
    const snapshotId = await t.run((ctx) => takeSnapshot(ctx, tournamentId, "test", adminId));

    const teamC = await asAdmin.mutation(api.teams.create, {
      tournamentId,
      name: "Team C",
      ownerName: "Owner C",
      colorPrimary: "#333333",
      colorSecondary: "#444444",
    });
    await asAdmin.mutation(api.admin.updatePlayerStatus, { playerId, newStatus: "sold", teamId: teamC, soldPrice: 300_000 });
    await asAdmin.mutation(api.snapshots.restoreSnapshot, { snapshotId, confirmName: "Purse Cup" });

    expect((await t.run((ctx) => ctx.db.get(playerId)))?.auctionStatus).toBe("pending");
    expect(await t.run((ctx) => ctx.db.get(teamC))).toMatchObject({ purseSpent: 0, purseRemaining: 1_000_000 });
    expect(await reconcile(t, tournamentId)).toEqual({ ok: true, issues: [] });
  });

  test("a new team keeps its own purse adjustment", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { adminId, tournamentId } = await setup(t);
    const playerId = await addPlayer(t, tournamentId, "Virat");
    const snapshotId = await t.run((ctx) => takeSnapshot(ctx, tournamentId, "test", adminId));

    const teamC = await asAdmin.mutation(api.teams.create, {
      tournamentId,
      name: "Team C",
      ownerName: "Owner C",
      colorPrimary: "#333333",
      colorSecondary: "#444444",
    });
    await asAdmin.mutation(api.admin.adjustTeamPurse, { teamId: teamC, amount: 50_000, reason: "sponsor top-up" });
    await asAdmin.mutation(api.admin.updatePlayerStatus, { playerId, newStatus: "sold", teamId: teamC, soldPrice: 300_000 });
    await asAdmin.mutation(api.snapshots.restoreSnapshot, { snapshotId, confirmName: "Purse Cup" });

    expect(await t.run((ctx) => ctx.db.get(teamC))).toMatchObject({
      purseSpent: 0,
      purseRemaining: 1_050_000,
      purseAdjustment: 50_000,
    });
    expect(await reconcile(t, tournamentId)).toEqual({ ok: true, issues: [] });
  });

  test("a sold player deleted after the snapshot doesn't leave their price on the team", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { adminId, tournamentId, teamA } = await setup(t);
    const playerId = await addPlayer(t, tournamentId, "Virat");
    await asAdmin.mutation(api.admin.updatePlayerStatus, { playerId, newStatus: "sold", teamId: teamA, soldPrice: 200_000 });
    const snapshotId = await t.run((ctx) => takeSnapshot(ctx, tournamentId, "test", adminId));

    await asAdmin.mutation(api.players.deleteAllByTournament, { tournamentId, includesSold: true });
    await asAdmin.mutation(api.snapshots.restoreSnapshot, { snapshotId, confirmName: "Purse Cup" });

    expect(await t.run((ctx) => ctx.db.get(teamA))).toMatchObject({ purseSpent: 0, purseRemaining: 1_000_000 });
    expect(await reconcile(t, tournamentId)).toEqual({ ok: true, issues: [] });
  });

  test("ending a rehearsal also leaves a team added during it consistent", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId } = await setup(t);
    const playerId = await addPlayer(t, tournamentId, "Virat");

    await asAdmin.mutation(api.snapshots.startRehearsal, { auctionRoomId: roomId });
    const teamC = await asAdmin.mutation(api.teams.create, {
      tournamentId,
      name: "Team C",
      ownerName: "Owner C",
      colorPrimary: "#333333",
      colorSecondary: "#444444",
    });
    await asAdmin.mutation(api.admin.updatePlayerStatus, { playerId, newStatus: "sold", teamId: teamC, soldPrice: 300_000 });
    await asAdmin.mutation(api.snapshots.endRehearsal, { auctionRoomId: roomId });

    expect(await t.run((ctx) => ctx.db.get(teamC))).toMatchObject({ purseSpent: 0, purseRemaining: 1_000_000 });
    expect(await reconcile(t, tournamentId)).toEqual({ ok: true, issues: [] });
  });
});

describe("changing the base purse never breaks a purse (DATA-002)", () => {
  const settings = (basePurse: number) => ({ basePurse, minBidIncrement: 25_000, maxPlayersPerTeam: 3, basePrice: 100_000 });

  test("refuses a base purse below what a team has already spent", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA } = await setup(t);
    const playerId = await addPlayer(t, tournamentId, "Virat");
    await asAdmin.mutation(api.admin.updatePlayerStatus, { playerId, newStatus: "sold", teamId: teamA, soldPrice: 600_000 });

    await expect(
      asAdmin.mutation(api.tournaments.update, { id: tournamentId, settings: settings(500_000) }),
    ).rejects.toThrow(/Team A has already spent/);

    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.settings.basePurse).toBe(1_000_000);
    expect(await t.run((ctx) => ctx.db.get(teamA))).toMatchObject({ purseSpent: 600_000, purseRemaining: 400_000 });
    expect(await reconcile(t, tournamentId)).toEqual({ ok: true, issues: [] });
  });

  test("a lower base purse that still covers every team's spend is applied", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA } = await setup(t);
    const playerId = await addPlayer(t, tournamentId, "Virat");
    await asAdmin.mutation(api.admin.updatePlayerStatus, { playerId, newStatus: "sold", teamId: teamA, soldPrice: 200_000 });

    await asAdmin.mutation(api.tournaments.update, { id: tournamentId, settings: settings(800_000) });

    expect(await t.run((ctx) => ctx.db.get(teamA))).toMatchObject({ purseSpent: 200_000, purseRemaining: 600_000 });
    expect(await reconcile(t, tournamentId)).toEqual({ ok: true, issues: [] });
  });
});

describe("sale corrections follow the squad rules bids follow (DATA-004)", () => {
  const MARQUEE = { id: "marquee", name: "Marquee", basePrice: 100_000, order: 1, colour: "#f59e0b" };

  async function withRules(
    t: ReturnType<typeof convexTest>,
    squadRules: Array<{ id: string; categoryId?: string; role?: string; min?: number; max?: number }>,
  ) {
    const ids = await setup(t);
    await t.run(async (ctx) => {
      const tournament = (await ctx.db.get(ids.tournamentId))!;
      await ctx.db.patch(ids.tournamentId, { settings: { ...tournament.settings, categories: [MARQUEE], squadRules } });
    });
    return ids;
  }

  async function addTo(
    t: ReturnType<typeof convexTest>,
    tournamentId: Id<"tournaments">,
    name: string,
    fields: { categoryId?: string; role?: string[] } = {},
  ) {
    return await t.run((ctx) =>
      ctx.db.insert("players", {
        tournamentId,
        name,
        age: 30,
        role: fields.role ?? ["Batter"],
        categoryId: fields.categoryId,
        battingBowlingHand: "Right-handed",
        auctionStatus: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
  }

  test("a max rule: a second Marquee can't be sold to a team allowed one", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA } = await withRules(t, [{ id: "max-marquee", categoryId: "marquee", max: 1 }]);
    const first = await addTo(t, tournamentId, "First", { categoryId: "marquee" });
    const second = await addTo(t, tournamentId, "Second", { categoryId: "marquee" });
    await asAdmin.mutation(api.admin.updatePlayerStatus, { playerId: first, newStatus: "sold", teamId: teamA, soldPrice: 100_000 });

    await expect(
      asAdmin.mutation(api.admin.updatePlayerStatus, { playerId: second, newStatus: "sold", teamId: teamA, soldPrice: 100_000 }),
    ).rejects.toThrow(/max 1/);
    await expect(
      asAdmin.mutation(api.admin.reassignPlayer, { playerId: second, newTeamId: teamA, newSoldPrice: 100_000 }),
    ).rejects.toThrow(/max 1/);
    expect(await reconcile(t, tournamentId)).toEqual({ ok: true, issues: [] });
  });

  test("a min rule: the last slots stay free for the required role", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    // Squad of 3, at least 2 wicket keepers: after one batter, the next two must be keepers.
    const { tournamentId, teamA } = await withRules(t, [{ id: "min-wk", role: "Wicket Keeper", min: 2 }]);
    const batter1 = await addTo(t, tournamentId, "Batter One");
    const batter2 = await addTo(t, tournamentId, "Batter Two");
    const keeper = await addTo(t, tournamentId, "Keeper", { role: ["Wicket Keeper"] });
    await asAdmin.mutation(api.admin.updatePlayerStatus, { playerId: batter1, newStatus: "sold", teamId: teamA, soldPrice: 100_000 });

    await expect(
      asAdmin.mutation(api.admin.updatePlayerStatus, { playerId: batter2, newStatus: "sold", teamId: teamA, soldPrice: 100_000 }),
    ).rejects.toThrow(/last 2 slots/);
    await asAdmin.mutation(api.admin.updatePlayerStatus, { playerId: keeper, newStatus: "sold", teamId: teamA, soldPrice: 100_000 });
    expect(await reconcile(t, tournamentId)).toEqual({ ok: true, issues: [] });
  });

  test("re-pricing a player already on the team isn't blocked by their own rule", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA } = await withRules(t, [{ id: "max-marquee", categoryId: "marquee", max: 1 }]);
    const first = await addTo(t, tournamentId, "First", { categoryId: "marquee" });
    await asAdmin.mutation(api.admin.updatePlayerStatus, { playerId: first, newStatus: "sold", teamId: teamA, soldPrice: 100_000 });
    await asAdmin.mutation(api.admin.updateSoldPrice, { playerId: first, newSoldPrice: 150_000 });
    await asAdmin.mutation(api.admin.reassignPlayer, { playerId: first, newTeamId: teamA, newSoldPrice: 175_000 });
    expect((await t.run((ctx) => ctx.db.get(first)))?.soldPrice).toBe(175_000);
  });
});
