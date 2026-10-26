/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { syncTournamentAuctionCounts } from "./auctionCounts";

// Discover the Convex function modules for the test runtime (see
// auctions.test.ts for why _generated must stay included).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };
const USER_IDENTITY = { email: "user@test.com", subject: "user|1" };

/**
 * Seed an admin + regular user, a tournament with two teams, a live room and
 * one player on the block.
 */
async function setup(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", {
      email: ADMIN_IDENTITY.email,
      role: "admin",
      createdAt: now,
    });
    await ctx.db.insert("users", {
      email: USER_IDENTITY.email,
      role: "user",
      createdAt: now,
    });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Test Cup",
      createdBy: adminId,
      status: "active",
      settings: {
        basePurse: 1_000_000,
        minBidIncrement: 25_000,
        bidTimerSeconds: 30,
        maxPlayersPerTeam: 3,
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
        purseRemaining: 1_000_000,
        purseSpent: 0,
        colorPrimary: "#111111",
        colorSecondary: "#222222",
        createdAt: now,
        updatedAt: now,
      });
    const teamA = await mkTeam("Team A");
    const teamB = await mkTeam("Team B");
    const playerId = await ctx.db.insert("players", {
      tournamentId,
      name: "Virat",
      age: 30,
      role: "Batter",
      battingBowlingHand: "Right-handed",
      auctionStatus: "in_auction",
      createdAt: now,
      updatedAt: now,
    });
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room 1",
      status: "live",
      currentPlayerId: playerId,
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    await syncTournamentAuctionCounts(ctx, tournamentId);
    return { tournamentId, teamA, teamB, roomId, playerId };
  });
}

async function sellToTeamA(
  t: ReturnType<typeof convexTest>,
  ids: Awaited<ReturnType<typeof setup>>,
) {
  const asAdmin = t.withIdentity(ADMIN_IDENTITY);
  await asAdmin.mutation(api.auctions.placeBid, {
    auctionRoomId: ids.roomId,
    teamId: ids.teamA,
    amount: 200_000,
  });
  await asAdmin.mutation(api.auctions.finalizePlayerSale, {
    auctionRoomId: ids.roomId,
  });
}

describe("auctions.getReconciliation", () => {
  test("reports ok after a normal sale", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await sellToTeamA(t, ids);

    const res = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.auctions.getReconciliation, { tournamentId: ids.tournamentId });

    expect(res).toEqual({ ok: true, issues: [] });
  });

  test("reports an issue after a direct purse patch", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await sellToTeamA(t, ids);
    await t.run((ctx) => ctx.db.patch(ids.teamA, { purseSpent: 150_000 }));

    const res = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.auctions.getReconciliation, { tournamentId: ids.tournamentId });

    expect(res.ok).toBe(false);
    expect(res.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "purse_spent", teamId: ids.teamA }),
        expect.objectContaining({ kind: "purse_total", teamId: ids.teamA }),
      ]),
    );
    expect(res.issues.some((i) => i.teamId === ids.teamB)).toBe(false);
  });

  test("reports drifted status counts", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await t.run(async (ctx) => {
      const tournament = await ctx.db.get(ids.tournamentId);
      await ctx.db.patch(ids.tournamentId, {
        auctionCounts: { ...tournament!.auctionCounts!, pending: 7 },
      });
    });

    const res = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.auctions.getReconciliation, { tournamentId: ids.tournamentId });

    expect(res.issues).toEqual([
      expect.objectContaining({ kind: "status_counts" }),
    ]);
  });

  test("is admin-only", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);

    await expect(
      t
        .withIdentity(USER_IDENTITY)
        .query(api.auctions.getReconciliation, {
          tournamentId: ids.tournamentId,
        }),
    ).rejects.toThrow("You don't have access to this tournament");
  });
});
