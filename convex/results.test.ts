/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

// Step 14: results export (admin) and the public results page query.
// Fixtures follow auctions.test.ts (see there for why _generated stays in).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };
const USER_IDENTITY = { email: "fan@test.com", subject: "user|1" };
const PHONE = "9876543210";

/**
 * A finished auction: Team A has a captain and two buys (one sold live, one
 * whose price an admin corrected afterwards), Team B one buy assigned by an
 * admin with no sale event; plus one unsold and one final-unsold player.
 */
async function seedCompleted(
  t: ReturnType<typeof convexTest>,
  opts: { status?: Doc<"tournaments">["status"]; isActive?: boolean } = {},
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", { email: ADMIN_IDENTITY.email, role: "admin", createdAt: now });
    await ctx.db.insert("users", { email: USER_IDENTITY.email, role: "user", createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Results Cup",
      createdBy: adminId,
      status: opts.status ?? "completed",
      isActive: opts.isActive,
      settings: {
        basePurse: 1_000_000,
        minBidIncrement: 25_000,
        maxPlayersPerTeam: 5,
        basePrice: 100_000,
        categories: [{ id: "marquee", name: "Marquee", basePrice: 300_000, order: 0, colour: "#f59e0b" }],
      },
      createdAt: now,
      updatedAt: now,
    });
    const player = (fields: Partial<Doc<"players">>) =>
      ctx.db.insert("players", {
        tournamentId,
        name: "Player",
        age: 25,
        role: ["Batter"],
        battingBowlingHand: "Right-handed",
        phoneNumber: PHONE,
        auctionStatus: "pending",
        createdAt: now,
        updatedAt: now,
        ...fields,
      });
    const captain = await player({ name: "Captain A" });
    const teamA = await ctx.db.insert("teams", {
      tournamentId,
      name: "Team A",
      ownerName: "owner",
      captainPlayerId: captain,
      captainName: "Captain A",
      purseRemaining: 450_000,
      purseSpent: 550_000,
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      createdAt: now,
      updatedAt: now,
    });
    const teamB = await ctx.db.insert("teams", {
      tournamentId,
      name: "Team B",
      ownerName: "owner",
      purseRemaining: 800_000,
      purseSpent: 200_000,
      colorPrimary: "#333333",
      colorSecondary: "#444444",
      createdAt: now,
      updatedAt: now,
    });
    const virat = await player({ name: "Virat", categoryId: "marquee", auctionStatus: "sold", teamId: teamA, soldPrice: 400_000 });
    // Sold live at 1.25L; an admin later corrected the price to 1.5L (G16).
    const rohit = await player({ name: "Rohit", auctionStatus: "sold", teamId: teamA, soldPrice: 150_000 });
    // Assigned by an admin correction: no sale event at all.
    const dhoni = await player({ name: "Dhoni", role: ["Wicket Keeper"], auctionStatus: "sold", teamId: teamB, soldPrice: 200_000 });
    await player({ name: "Unsold Joe", auctionStatus: "unsold", basePrice: 150_000 });
    await player({ name: "Gone Jim", auctionStatus: "final_unsold" });

    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room 1",
      status: "completed",
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    const sold = (playerId: Id<"players">, teamId: Id<"teams">, amount: number, timestamp: number, bidCount?: number) =>
      ctx.db.insert("auctionEvents", {
        auctionRoomId: roomId,
        type: "player_sold",
        data: { playerId, teamId, amount, playerName: "x", teamName: "y", ...(bidCount !== undefined ? { bidCount } : {}) },
        timestamp,
      });
    await sold(virat, teamA, 400_000, now - 2_000, 6);
    await sold(rohit, teamA, 125_000, now - 1_000); // legacy event: no bidCount
    return { tournamentId, teamA, teamB, roomId, virat, rohit, dhoni };
  });
}

describe("getPublicResults", () => {
  test("returns squads for a completed, active tournament — with no session", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, teamA } = await seedCompleted(t);

    const results = await t.query(api.results.getPublicResults, { tournamentId });
    expect(results?.tournament.name).toBe("Results Cup");
    const a = results!.teams.find((x) => x._id === teamA)!;
    expect(a.players.map((p) => p.name)).toEqual(["Virat", "Rohit"]); // by price, captain separate
    expect(a.captain?.name).toBe("Captain A");
    expect(results!.topBuys[0]).toMatchObject({ name: "Virat", soldPrice: 400_000 });
    expect(results!.totals).toEqual({ sold: 3, unsold: 2, spent: 750_000 });
  });

  test("never returns a phone number", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seedCompleted(t);
    const json = JSON.stringify(await t.query(api.results.getPublicResults, { tournamentId }));
    expect(json).not.toContain(PHONE);
    expect(json).not.toContain("phoneNumber");
  });

  test("returns nothing while the tournament is not completed", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seedCompleted(t, { status: "active" });
    expect(await t.query(api.results.getPublicResults, { tournamentId })).toBeNull();
  });

  test("returns nothing for a deactivated tournament, even to an admin", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seedCompleted(t, { isActive: false });
    expect(await t.query(api.results.getPublicResults, { tournamentId })).toBeNull();
    expect(
      await t.withIdentity(ADMIN_IDENTITY).query(api.results.getPublicResults, { tournamentId }),
    ).toBeNull();
  });
});

describe("getResultsExport", () => {
  test("admin only", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seedCompleted(t);
    await expect(
      t.withIdentity(USER_IDENTITY).query(api.results.getResultsExport, { tournamentId, includeContacts: false }),
    ).rejects.toThrow(/access to this tournament/);
    await expect(
      t.query(api.results.getResultsExport, { tournamentId, includeContacts: false }),
    ).rejects.toThrow();
  });

  test("final truth comes from players and teams; timing from sale events (G16)", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, virat, rohit, dhoni } = await seedCompleted(t);
    const data = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.results.getResultsExport, { tournamentId, includeContacts: false });

    const byId = new Map(data.players.map((p) => [p._id, p]));
    expect(byId.get(rohit)?.soldPrice).toBe(150_000); // corrected price, not the 1.25L bid
    expect(data.sales.map((s) => s.playerId)).toEqual([virat, rohit]);
    expect(data.sales[0]).toMatchObject({ amount: 400_000, bidCount: 6 });
    expect(data.sales[1].bidCount).toBeUndefined();
    expect(byId.get(dhoni)?.auctionStatus).toBe("sold"); // sold, but no event
    expect(data.contacts).toBeNull();
  });

  test("phone numbers only when contacts are requested", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seedCompleted(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    const without = await asAdmin.query(api.results.getResultsExport, { tournamentId, includeContacts: false });
    expect(JSON.stringify(without)).not.toContain(PHONE);

    const withContacts = await asAdmin.query(api.results.getResultsExport, { tournamentId, includeContacts: true });
    expect(withContacts.contacts).toHaveLength(6);
    expect(withContacts.contacts?.[0].phoneNumber).toBe(PHONE);
  });
});

describe("finalizePlayerSale records the bid count", () => {
  test("player_sold events carry bidCount", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { roomId, teamA, teamB, tournamentId } = await seedCompleted(t, { status: "active" });
    const playerId = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(roomId, { status: "live" });
      const id = await ctx.db.insert("players", {
        tournamentId,
        name: "Fresh",
        age: 22,
        role: ["Bowler"],
        battingBowlingHand: "Right-handed",
        auctionStatus: "in_auction",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(roomId, { currentPlayerId: id });
      return id;
    });
    await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamA, amount: 100_000 });
    await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamB, amount: 125_000 });
    await asAdmin.mutation(api.auctions.finalizePlayerSale, { auctionRoomId: roomId });

    const event = await t.run(async (ctx) =>
      (await ctx.db.query("auctionEvents").collect()).find(
        (e) => e.type === "player_sold" && e.data.playerId === playerId,
      ),
    );
    expect(event?.data.bidCount).toBe(2);
  });
});
