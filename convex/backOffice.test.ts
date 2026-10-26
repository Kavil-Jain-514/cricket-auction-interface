/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { syncTournamentAuctionCounts } from "./auctionCounts";

// Step 15: back office — users, audit log, purse tools. Fixtures follow
// auctions.test.ts (see there for why _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };
const OTHER_ADMIN_IDENTITY = { email: "admin2@test.com", subject: "admin|2" };
const USER_IDENTITY = { email: "user@test.com", subject: "user|1" };

const SETTINGS: Doc<"tournaments">["settings"] = {
  basePurse: 1_000_000,
  minBidIncrement: 25_000,
  maxPlayersPerTeam: 5,
  basePrice: 100_000,
};

async function setup(t: ReturnType<typeof convexTest>, opts: { secondAdmin?: boolean } = {}) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", { email: ADMIN_IDENTITY.email, role: "admin", createdAt: now });
    const otherAdminId = opts.secondAdmin
      ? await ctx.db.insert("users", { email: OTHER_ADMIN_IDENTITY.email, role: "admin", createdAt: now })
      : null;
    const userId = await ctx.db.insert("users", { email: USER_IDENTITY.email, role: "user", createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Office Cup",
      createdBy: adminId,
      status: "active",
      settings: SETTINGS,
      createdAt: now,
      updatedAt: now,
    });
    const teamId = await ctx.db.insert("teams", {
      tournamentId,
      name: "Team A",
      ownerName: "owner",
      purseRemaining: 800_000,
      purseSpent: 200_000,
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("players", {
      tournamentId,
      name: "Bought",
      age: 25,
      role: ["Batter"],
      battingBowlingHand: "Right-handed",
      auctionStatus: "sold",
      teamId,
      soldPrice: 200_000,
      createdAt: now,
      updatedAt: now,
    });
    await syncTournamentAuctionCounts(ctx, tournamentId);
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room 1",
      status: "waiting",
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    return { adminId, otherAdminId, userId, tournamentId, teamId, roomId };
  });
}

const reconciliationOk = async (t: ReturnType<typeof convexTest>, tournamentId: Id<"tournaments">) =>
  (await t.withIdentity(ADMIN_IDENTITY).query(api.auctions.getReconciliation, { tournamentId })).ok;

describe("setUserRole — last-admin guard", () => {
  test("the only admin cannot demote themselves", async () => {
    const t = convexTest(schema, modules);
    const { adminId } = await setup(t);
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.auth.setUserRole, { userId: adminId, role: "user" }),
    ).rejects.toThrow(/last admin/);
    expect((await t.run((ctx) => ctx.db.get(adminId)))?.role).toBe("admin");
  });

  test("with two admins, one can step down", async () => {
    const t = convexTest(schema, modules);
    const { adminId } = await setup(t, { secondAdmin: true });
    await t.withIdentity(ADMIN_IDENTITY).mutation(api.auth.setUserRole, { userId: adminId, role: "user" });
    expect((await t.run((ctx) => ctx.db.get(adminId)))?.role).toBe("user");
  });

  test("promote works; non-admins can't change roles", async () => {
    const t = convexTest(schema, modules);
    const { userId, adminId } = await setup(t);
    await expect(
      t.withIdentity(USER_IDENTITY).mutation(api.auth.setUserRole, { userId: adminId, role: "user" }),
    ).rejects.toThrow();
    await t.withIdentity(ADMIN_IDENTITY).mutation(api.auth.setUserRole, { userId, role: "admin" });
    expect((await t.run((ctx) => ctx.db.get(userId)))?.role).toBe("admin");
  });
});

describe("listAuditLogs — paginated and filtered", () => {
  async function seedLogs(t: ReturnType<typeof convexTest>, tournamentId: Id<"tournaments">, adminId: Id<"users">) {
    await t.run(async (ctx) => {
      const base = Date.UTC(2026, 9, 1);
      for (let i = 0; i < 25; i++) {
        await ctx.db.insert("auditLogs", {
          userId: adminId,
          userEmail: ADMIN_IDENTITY.email,
          action: i % 5 === 0 ? "update_sold_price" : "start_next_player",
          targetType: "player",
          targetId: `p${i}`,
          tournamentId: i < 20 ? tournamentId : undefined,
          timestamp: base + i * 86_400_000, // one per day from 1 Oct
        });
      }
    });
  }

  test("pages through every log, newest first", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, adminId } = await setup(t);
    await seedLogs(t, tournamentId, adminId);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const page: { page: Doc<"auditLogs">[]; isDone: boolean; continueCursor: string } = await asAdmin.query(
        api.auth.listAuditLogs,
        { paginationOpts: { numItems: 10, cursor } },
      );
      seen.push(...page.page.map((l) => l.targetId));
      pages++;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(25);
    expect(seen[0]).toBe("p24");
  });

  test("filters by tournament, action and date range", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, adminId } = await setup(t);
    await seedLogs(t, tournamentId, adminId);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    const byTournament = await asAdmin.query(api.auth.listAuditLogs, {
      tournamentId,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(byTournament.page).toHaveLength(20);

    const byAction = await asAdmin.query(api.auth.listAuditLogs, {
      tournamentId,
      action: "update_sold_price",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(byAction.page.map((l) => l.targetId)).toEqual(["p15", "p10", "p5", "p0"]);

    const byDate = await asAdmin.query(api.auth.listAuditLogs, {
      from: Date.UTC(2026, 9, 3),
      to: Date.UTC(2026, 9, 5, 23, 59),
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(byDate.page.map((l) => l.targetId)).toEqual(["p4", "p3", "p2"]);
  });

  test("non-admins get nothing", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, adminId } = await setup(t);
    await seedLogs(t, tournamentId, adminId);
    const res = await t.withIdentity(USER_IDENTITY).query(api.auth.listAuditLogs, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(res.page).toEqual([]);
  });
});

describe("purse tools", () => {
  test("adjustTeamPurse moves remaining and the ledger; reconciliation stays ok", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, teamId } = await setup(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    expect(await reconciliationOk(t, tournamentId)).toBe(true);

    await asAdmin.mutation(api.admin.adjustTeamPurse, { teamId, amount: -50_000, reason: "Late to the auction" });
    await asAdmin.mutation(api.admin.adjustTeamPurse, { teamId, amount: 100_000, reason: "Sponsor top-up" });

    const team = (await t.run((ctx) => ctx.db.get(teamId)))!;
    expect(team).toMatchObject({ purseRemaining: 850_000, purseSpent: 200_000, purseAdjustment: 50_000 });
    expect(await reconciliationOk(t, tournamentId)).toBe(true);

    const log = await t.run((ctx) => ctx.db.query("auditLogs").order("desc").first());
    expect(log).toMatchObject({ action: "adjust_team_purse", newData: { reason: "Sponsor top-up" } });
  });

  test("adjustTeamPurse needs a reason and can't push remaining below zero", async () => {
    const t = convexTest(schema, modules);
    const { teamId } = await setup(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await expect(asAdmin.mutation(api.admin.adjustTeamPurse, { teamId, amount: 10_000, reason: "  " })).rejects.toThrow(/reason/i);
    await expect(asAdmin.mutation(api.admin.adjustTeamPurse, { teamId, amount: -900_000, reason: "x" })).rejects.toThrow(/below/);
    await expect(asAdmin.mutation(api.admin.adjustTeamPurse, { teamId, amount: 0, reason: "x" })).rejects.toThrow();
    await expect(
      t.withIdentity(USER_IDENTITY).mutation(api.admin.adjustTeamPurse, { teamId, amount: 10_000, reason: "x" }),
    ).rejects.toThrow();
  });

  test("recalculateTeamPurse repairs drift; reconciliation goes from failing to ok", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, teamId } = await setup(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await asAdmin.mutation(api.admin.adjustTeamPurse, { teamId, amount: 50_000, reason: "Bonus" });
    // Simulate drift from an old bug.
    await t.run((ctx) => ctx.db.patch(teamId, { purseRemaining: 1_234, purseSpent: 9_999 }));
    expect(await reconciliationOk(t, tournamentId)).toBe(false);

    await asAdmin.mutation(api.admin.recalculateTeamPurse, { teamId, reason: "Fix drift" });
    const team = (await t.run((ctx) => ctx.db.get(teamId)))!;
    expect(team).toMatchObject({ purseSpent: 200_000, purseRemaining: 850_000, purseAdjustment: 50_000 });
    expect(await reconciliationOk(t, tournamentId)).toBe(true);
  });

  test("adjustments survive a base purse change and an auction restart", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, teamId, roomId } = await setup(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await asAdmin.mutation(api.admin.adjustTeamPurse, { teamId, amount: -50_000, reason: "Penalty" });

    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...SETTINGS, basePurse: 2_000_000 },
    });
    expect((await t.run((ctx) => ctx.db.get(teamId)))?.purseRemaining).toBe(1_750_000);
    expect(await reconciliationOk(t, tournamentId)).toBe(true);

    await asAdmin.mutation(api.auctions.restartAuction, { auctionRoomId: roomId });
    expect(await t.run((ctx) => ctx.db.get(teamId))).toMatchObject({
      purseRemaining: 1_950_000,
      purseSpent: 0,
      purseAdjustment: -50_000,
    });
    expect(await reconciliationOk(t, tournamentId)).toBe(true);
  });
});

describe("clearCurrentPlayerBids", () => {
  test("requires a reason", async () => {
    const t = convexTest(schema, modules);
    const { roomId, tournamentId } = await setup(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      const playerId = await ctx.db.insert("players", {
        tournamentId,
        name: "On the block",
        age: 25,
        role: ["Batter"],
        battingBowlingHand: "Right-handed",
        auctionStatus: "in_auction",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(roomId, { status: "live", currentPlayerId: playerId });
    });
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await expect(
      asAdmin.mutation(api.admin.clearCurrentPlayerBids, { auctionRoomId: roomId, reason: " " }),
    ).rejects.toThrow(/reason/i);
    await expect(
      asAdmin.mutation(api.admin.clearCurrentPlayerBids, { auctionRoomId: roomId, reason: "Wrong team called" }),
    ).resolves.toMatchObject({ success: true });
  });
});
