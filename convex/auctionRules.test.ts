/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { syncTournamentAuctionCounts } from "./auctionCounts";

// Step 12a: player categories (base-price fallback) and increment slabs.
// Fixtures follow auctions.test.ts (see there for why _generated stays in).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };

type Settings = Doc<"tournaments">["settings"];

const MARQUEE = {
  id: "marquee",
  name: "Marquee",
  basePrice: 500_000,
  order: 0,
  colour: "#f59e0b",
};
const SET_A = {
  id: "a",
  name: "Set A",
  basePrice: 200_000,
  order: 1,
  colour: "#2563eb",
};
const SLABS = [
  { fromAmount: 0, increment: 25_000 },
  { fromAmount: 500_000, increment: 50_000 },
];

const BASE_SETTINGS: Settings = {
  basePurse: 10_000_000,
  minBidIncrement: 25_000,
  bidTimerSeconds: 30,
  maxPlayersPerTeam: 5,
  basePrice: 100_000,
};

/** Admin + tournament + two teams + a room in the given status. */
async function setup(
  t: ReturnType<typeof convexTest>,
  opts: { settings?: Partial<Settings>; roomStatus?: Doc<"auctionRooms">["status"] } = {},
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", {
      email: ADMIN_IDENTITY.email,
      role: "admin",
      createdAt: now,
    });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Rules Cup",
      createdBy: adminId,
      status: "active",
      settings: { ...BASE_SETTINGS, ...opts.settings },
      createdAt: now,
      updatedAt: now,
    });
    const mkTeam = (name: string) =>
      ctx.db.insert("teams", {
        tournamentId,
        name,
        ownerName: "owner",
        purseRemaining: BASE_SETTINGS.basePurse,
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
      status: opts.roomStatus ?? "live",
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    return { tournamentId, teamA, teamB, roomId };
  });
}

async function insertPlayer(
  t: ReturnType<typeof convexTest>,
  tournamentId: Id<"tournaments">,
  fields: Partial<Doc<"players">> = {},
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("players", {
      tournamentId,
      name: "Player",
      age: 25,
      role: ["Batter"],
      battingBowlingHand: "Right-handed",
      auctionStatus: "pending",
      createdAt: now,
      updatedAt: now,
      ...fields,
    });
    await syncTournamentAuctionCounts(ctx, tournamentId);
    return id;
  });
}

async function putInAuction(
  t: ReturnType<typeof convexTest>,
  roomId: Id<"auctionRooms">,
  playerId: Id<"players">,
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(playerId, { auctionStatus: "in_auction" });
    await ctx.db.patch(roomId, { currentPlayerId: playerId });
  });
}

/** Seed a live bid directly so a test can start from any current price. */
async function seedBid(
  t: ReturnType<typeof convexTest>,
  args: { roomId: Id<"auctionRooms">; playerId: Id<"players">; teamId: Id<"teams">; amount: number },
) {
  await t.run(async (ctx) => {
    const admin = await ctx.db.query("users").first();
    await ctx.db.insert("liveBids", {
      auctionRoomId: args.roomId,
      playerId: args.playerId,
      teamId: args.teamId,
      amount: args.amount,
      timestamp: Date.now() - 10_000, // clear of the same-team spacing guard
      source: "admin",
      userId: admin!._id,
    });
  });
}

describe("increment slabs in placeBid", () => {
  test("below a boundary the lower band applies (₹4.75L + ₹25k)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA, teamB } = await setup(t, {
      settings: { incrementSlabs: SLABS },
    });
    const playerId = await insertPlayer(t, tournamentId);
    await putInAuction(t, roomId, playerId);
    await seedBid(t, { roomId, playerId, teamId: teamA, amount: 475_000 });

    const res = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamB,
      amount: 500_000,
    });
    expect(res).toMatchObject({ success: true, amount: 500_000 });
  });

  test("exactly at 5L the next band (₹50k) applies", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA, teamB } = await setup(t, {
      settings: { incrementSlabs: SLABS },
    });
    const playerId = await insertPlayer(t, tournamentId);
    await putInAuction(t, roomId, playerId);
    await seedBid(t, { roomId, playerId, teamId: teamA, amount: 500_000 });

    const tooLow = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamB,
      amount: 525_000,
    });
    expect(tooLow).toMatchObject({ success: false, reason: "Minimum bid is 550000" });

    const ok = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamB,
      amount: 550_000,
    });
    expect(ok).toMatchObject({ success: true, amount: 550_000 });
  });

  test("the paddle and the raises tray report the slab-based next bid", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA } = await setup(t, {
      settings: { incrementSlabs: SLABS },
    });
    const playerId = await insertPlayer(t, tournamentId);
    await putInAuction(t, roomId, playerId);
    await seedBid(t, { roomId, playerId, teamId: teamA, amount: 500_000 });

    const tray = await asAdmin.query(api.auctions.getPendingBidRequests, {
      auctionRoomId: roomId,
    });
    expect(tray.minNextBid).toBe(550_000);
  });
});

describe("category base-price fallback", () => {
  test("a category player's first bid must reach the category base price", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA } = await setup(t, {
      settings: { categories: [MARQUEE, SET_A] },
    });
    const playerId = await insertPlayer(t, tournamentId, { categoryId: "marquee" });
    await putInAuction(t, roomId, playerId);

    const low = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 100_000,
    });
    expect(low).toMatchObject({ success: false, reason: "First bid must be at least base price" });

    const ok = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 500_000,
    });
    expect(ok).toMatchObject({ success: true, amount: 500_000 });
  });

  test("a player's own base price overrides the category", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA } = await setup(t, {
      settings: { categories: [MARQUEE] },
    });
    const playerId = await insertPlayer(t, tournamentId, {
      categoryId: "marquee",
      basePrice: 300_000,
    });
    await putInAuction(t, roomId, playerId);

    const ok = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 300_000,
    });
    expect(ok).toMatchObject({ success: true, amount: 300_000 });
  });

  test("roster, player list and pending reserve all resolve the category price", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId } = await setup(t, {
      settings: { categories: [MARQUEE, SET_A] },
    });
    const current = await insertPlayer(t, tournamentId, { categoryId: "marquee" });
    await insertPlayer(t, tournamentId, { name: "Pending A", categoryId: "a" });
    await putInAuction(t, roomId, current);
    await t.run((ctx) => syncTournamentAuctionCounts(ctx, tournamentId));

    const roster = (await t.query(api.auctions.getAuctionRoster, {
      tournamentId,
      currentPlayerId: current,
    }))!;
    expect(roster.currentPlayer?.basePrice).toBe(500_000);
    // Cheapest pending player is Set A (2L), not the tournament default (1L).
    expect(roster.minBasePrice).toBe(200_000);

    const list = await asAdmin.query(api.players.listByTournament, { tournamentId });
    const pendingA = list.find((p) => p.name === "Pending A")!;
    expect(pendingA.basePrice).toBe(200_000);
    expect(pendingA.basePriceOverride).toBeUndefined();
  });
});

describe("tournaments.update — categories and slabs", () => {
  test("saves valid categories and slabs before the auction", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { roomStatus: "waiting" });

    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...BASE_SETTINGS, categories: [MARQUEE, SET_A], incrementSlabs: SLABS },
    });
    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.settings.categories).toEqual([MARQUEE, SET_A]);
    expect(tournament?.settings.incrementSlabs).toEqual(SLABS);
  });

  test("omitting categories and slabs keeps the stored ones", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, {
      roomStatus: "waiting",
      settings: { categories: [MARQUEE], incrementSlabs: SLABS },
    });

    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...BASE_SETTINGS, basePurse: 20_000_000 },
    });
    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.settings.categories).toEqual([MARQUEE]);
    expect(tournament?.settings.incrementSlabs).toEqual(SLABS);
  });

  test("rejects invalid slabs", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { roomStatus: "waiting" });

    await expect(
      asAdmin.mutation(api.tournaments.update, {
        id: tournamentId,
        settings: { ...BASE_SETTINGS, incrementSlabs: [...SLABS].reverse() },
      }),
    ).rejects.toThrow();
  });

  test("categories and slabs are locked while the auction is live", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { roomStatus: "live" });

    await expect(
      asAdmin.mutation(api.tournaments.update, {
        id: tournamentId,
        settings: { ...BASE_SETTINGS, categories: [MARQUEE] },
      }),
    ).rejects.toThrow(/locked/);
    await expect(
      asAdmin.mutation(api.tournaments.update, {
        id: tournamentId,
        settings: { ...BASE_SETTINGS, incrementSlabs: SLABS },
      }),
    ).rejects.toThrow(/locked/);
  });

  test("cannot remove a category that players are still in", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, {
      roomStatus: "waiting",
      settings: { categories: [MARQUEE, SET_A] },
    });
    await insertPlayer(t, tournamentId, { categoryId: "marquee" });

    await expect(
      asAdmin.mutation(api.tournaments.update, {
        id: tournamentId,
        settings: { ...BASE_SETTINGS, categories: [SET_A] },
      }),
    ).rejects.toThrow(/Marquee/);
  });
});

describe("players — categoryId", () => {
  const newPlayer = {
    name: "Rohit",
    age: 33,
    role: ["Batter"],
    battingBowlingHand: "Right-handed" as const,
  };

  test("create stores a known category and rejects an unknown one", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { settings: { categories: [MARQUEE] } });

    const id = await asAdmin.mutation(api.players.create, {
      tournamentId,
      ...newPlayer,
      categoryId: "marquee",
    });
    expect((await t.run((ctx) => ctx.db.get(id)))?.categoryId).toBe("marquee");

    await expect(
      asAdmin.mutation(api.players.create, { tournamentId, ...newPlayer, categoryId: "nope" }),
    ).rejects.toThrow(/category/i);
  });

  test("bulkImport stores categories and reports an unknown one per row", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { settings: { categories: [MARQUEE] } });

    const bad = await asAdmin.mutation(api.players.bulkImport, {
      tournamentId,
      players: [{ ...newPlayer, categoryId: "nope" }],
    });
    expect(bad).toMatchObject({ success: false });

    const ok = await asAdmin.mutation(api.players.bulkImport, {
      tournamentId,
      players: [{ ...newPlayer, categoryId: "marquee" }],
    });
    expect(ok).toMatchObject({ success: true, count: 1 });
  });

  test("update can clear a base-price override back to the category price", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { settings: { categories: [MARQUEE] } });
    const id = await insertPlayer(t, tournamentId, { basePrice: 300_000 });

    await asAdmin.mutation(api.players.update, {
      id,
      categoryId: "marquee",
      basePrice: null,
    });
    const player = await t.run((ctx) => ctx.db.get(id));
    expect(player?.categoryId).toBe("marquee");
    expect(player?.basePrice).toBeUndefined();

    const [listed] = await asAdmin.query(api.players.listByTournament, { tournamentId });
    expect(listed.basePrice).toBe(500_000);
  });
});
