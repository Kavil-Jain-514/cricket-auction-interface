/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { toPublicPlayer } from "./projections";

// Same module discovery as auctions.test.ts — exclude test files, keep _generated.
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };
const USER_IDENTITY = { email: "user@test.com", subject: "user|1" };
const PHONE = "9876543210";

/**
 * Seed an admin + regular user, an active tournament with two teams, a live
 * room, and one player (with a phone number) on Team A who is also the room's
 * current player.
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
      phoneNumber: PHONE,
      age: 30,
      role: "Batter",
      battingBowlingHand: "Right-handed",
      basePrice: 200_000,
      teamId: teamA,
      auctionStatus: "in_auction",
      createdAt: now,
      updatedAt: now,
    });
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room 1",
      status: "live",
      createdBy: adminId,
      currentPlayerId: playerId,
      createdAt: now,
      updatedAt: now,
    });
    return { tournamentId, teamA, teamB, roomId, playerId };
  });
}

describe("toPublicPlayer", () => {
  test("drops phoneNumber and keeps every other field", () => {
    const player = { name: "Virat", age: 30, phoneNumber: PHONE, soldPrice: 5 };
    expect(toPublicPlayer(player)).toEqual({
      name: "Virat",
      age: 30,
      soldPrice: 5,
    });
  });
});

describe("auctions.getAuctionRoster", () => {
  test("never includes phoneNumber, for any caller", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, playerId } = await setup(t);
    const args = { tournamentId, currentPlayerId: playerId };

    for (const caller of [
      t,
      t.withIdentity(USER_IDENTITY),
      t.withIdentity(ADMIN_IDENTITY),
    ]) {
      const result = await caller.query(api.auctions.getAuctionRoster, args);
      expect(result.currentPlayer).not.toBeNull();
      expect(result.currentPlayer).not.toHaveProperty("phoneNumber");
      expect(result.currentPlayer?.name).toBe("Virat");
      expect(result.currentPlayer?.basePrice).toBe(200_000);
    }
  });
});

describe("teams.getWithPlayers", () => {
  test("includes phoneNumber for admins", async () => {
    const t = convexTest(schema, modules);
    const { teamA } = await setup(t);
    const result = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.teams.getWithPlayers, { id: teamA });
    expect(result?.players[0]).toHaveProperty("phoneNumber", PHONE);
  });

  test("excludes phoneNumber for users and anonymous callers", async () => {
    const t = convexTest(schema, modules);
    const { teamA } = await setup(t);
    for (const caller of [t, t.withIdentity(USER_IDENTITY)]) {
      const result = await caller.query(api.teams.getWithPlayers, { id: teamA });
      expect(result?.players).toHaveLength(1);
      expect(result?.players[0]).not.toHaveProperty("phoneNumber");
      expect(result?.players[0].name).toBe("Virat");
    }
  });
});

describe("admin.getPlayerWithTeam", () => {
  test("rejects anonymous callers and non-admin users", async () => {
    const t = convexTest(schema, modules);
    const { playerId } = await setup(t);
    await expect(
      t.query(api.admin.getPlayerWithTeam, { playerId }),
    ).rejects.toThrow("Not authenticated");
    await expect(
      t
        .withIdentity(USER_IDENTITY)
        .query(api.admin.getPlayerWithTeam, { playerId }),
    ).rejects.toThrow("You don't have access to this tournament");
  });

  test("returns the full player to admins", async () => {
    const t = convexTest(schema, modules);
    const { playerId, teamA } = await setup(t);
    const result = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.admin.getPlayerWithTeam, { playerId });
    expect(result?.phoneNumber).toBe(PHONE);
    expect(result?.team?._id).toBe(teamA);
  });
});
