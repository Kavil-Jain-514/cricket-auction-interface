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
      const result = (await caller.query(api.auctions.getAuctionRoster, args))!;
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


describe("couple partner phone", () => {
  const PARTNER_PHONE = "9123456780";
  const partner = { phoneNumber: PARTNER_PHONE, age: 28, role: ["Bowler"], battingBowlingHand: "Left-handed" as const };

  async function coupleSetup(t: ReturnType<typeof convexTest>) {
    const ids = await setup(t);
    await t.run(async (ctx) => {
      const tournament = (await ctx.db.get(ids.tournamentId))!;
      await ctx.db.patch(ids.tournamentId, { settings: { ...tournament.settings, format: "couple" } });
      await ctx.db.patch(ids.playerId, { partner });
    });
    return ids;
  }

  test("toPublicPlayer drops the partner's phone and keeps the rest of the partner", () => {
    expect(toPublicPlayer({ name: "Virat & Anu", phoneNumber: PHONE, partner })).toEqual({
      name: "Virat & Anu",
      partner: { age: 28, role: ["Bowler"], battingBowlingHand: "Left-handed" },
    });
    expect(toPublicPlayer({ name: "Solo", phoneNumber: PHONE })).toEqual({ name: "Solo" });
  });

  test("the auction roster's current player, team pages and the player list never show it to viewers", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, playerId, teamA } = await coupleSetup(t);
    for (const caller of [t, t.withIdentity(USER_IDENTITY), t.withIdentity(ADMIN_IDENTITY)]) {
      const roster = (await caller.query(api.auctions.getAuctionRoster, { tournamentId, currentPlayerId: playerId }))!;
      expect(roster.currentPlayer?.partner).toEqual({ age: 28, role: ["Bowler"], battingBowlingHand: "Left-handed" });
    }
    for (const caller of [t, t.withIdentity(USER_IDENTITY)]) {
      const team = await caller.query(api.teams.getWithPlayers, { id: teamA });
      expect(team?.players[0].partner).not.toHaveProperty("phoneNumber");
      const list = await caller.query(api.players.listByTournament, { tournamentId });
      expect(list[0].partner).toMatchObject({ role: ["Bowler"] });
      expect(list[0].partner).not.toHaveProperty("phoneNumber");
      expect(list[0]).not.toHaveProperty("phoneNumber");
    }
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    expect((await asAdmin.query(api.teams.getWithPlayers, { id: teamA }))?.players[0].partner?.phoneNumber).toBe(PARTNER_PHONE);
    expect((await asAdmin.query(api.players.listByTournament, { tournamentId }))[0].partner?.phoneNumber).toBe(PARTNER_PHONE);
  });

  test("public results show the partner without a phone", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, playerId } = await coupleSetup(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(playerId, { auctionStatus: "sold", soldPrice: 200_000 });
      await ctx.db.patch(tournamentId, { status: "completed" });
    });
    const results = await t.query(api.results.getPublicResults, { tournamentId });
    const sold = results!.teams.flatMap((team) => team.players);
    expect(sold[0].partner).toEqual({ age: 28, role: ["Bowler"], battingBowlingHand: "Left-handed" });
    expect(JSON.stringify(results)).not.toContain(PARTNER_PHONE);
  });
  test("the results export has the partner's phone only in its contacts", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await coupleSetup(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const plain = await asAdmin.query(api.results.getResultsExport, { tournamentId, includeContacts: false });
    expect(plain.tournament.format).toBe("couple");
    expect(plain.players[0]).toMatchObject({ partner: { role: ["Bowler"] } });
    expect(plain.players[0]).not.toHaveProperty("ranking");
    expect(JSON.stringify(plain)).not.toContain(PARTNER_PHONE);
    const withContacts = await asAdmin.query(api.results.getResultsExport, { tournamentId, includeContacts: true });
    expect(withContacts.contacts?.[0]).toMatchObject({ phoneNumber: PHONE, partnerPhoneNumber: PARTNER_PHONE });
  });
});
