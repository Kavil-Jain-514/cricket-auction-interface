/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { syncTournamentAuctionCounts } from "./auctionCounts";

// Step 12b: presentation order by category ("sets"). Fixtures follow
// auctions.test.ts (see there for why _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };

type Settings = Doc<"tournaments">["settings"];

const CATEGORIES = [
  // Orders deliberately not list positions: Marquee is first by order.
  { id: "a", name: "Set A", basePrice: 200_000, order: 5, colour: "#2563eb" },
  { id: "marquee", name: "Marquee", basePrice: 500_000, order: 1, colour: "#f59e0b" },
];

const BASE_SETTINGS: Settings = {
  basePurse: 10_000_000,
  minBidIncrement: 25_000,
  bidTimerSeconds: 30,
  maxPlayersPerTeam: 5,
  basePrice: 100_000,
  categories: CATEGORIES,
};

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
      name: "Sets Cup",
      createdBy: adminId,
      status: "active",
      settings: { ...BASE_SETTINGS, ...opts.settings },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("teams", {
      tournamentId,
      name: "Team A",
      ownerName: "owner",
      purseRemaining: BASE_SETTINGS.basePurse,
      purseSpent: 0,
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      createdAt: now,
      updatedAt: now,
    });
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room 1",
      status: opts.roomStatus ?? "live",
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    return { tournamentId, roomId };
  });
}

async function addPlayers(
  t: ReturnType<typeof convexTest>,
  tournamentId: Id<"tournaments">,
  players: Array<{ name: string; categoryId?: string }>,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ids: Record<string, Id<"players">> = {};
    for (const p of players) {
      ids[p.name] = await ctx.db.insert("players", {
        tournamentId,
        name: p.name,
        age: 25,
        role: ["Batter"],
        battingBowlingHand: "Right-handed",
        categoryId: p.categoryId,
        auctionStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }
    await syncTournamentAuctionCounts(ctx, tournamentId);
    return ids;
  });
}

/** startNextPlayer, then finalise the presented player unsold (no bids). */
async function presentAndPass(
  asAdmin: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  roomId: Id<"auctionRooms">,
) {
  const res = await asAdmin.mutation(api.auctions.startNextPlayer, { auctionRoomId: roomId });
  const player = "player" in res ? res.player : undefined;
  if (player) {
    await asAdmin.mutation(api.auctions.finalizePlayerSale, { auctionRoomId: roomId });
  }
  return { res, player };
}

describe("startNextPlayer — by_category sets", () => {
  test("announces each set, then presents its players, lowest order first; uncategorised last", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId } = await setup(t, {
      settings: { presentationOrder: "by_category" },
    });
    await addPlayers(t, tournamentId, [
      { name: "A1", categoryId: "a" },
      { name: "A2", categoryId: "a" },
      { name: "M1", categoryId: "marquee" },
      { name: "Free" },
    ]);
    const room = async () => (await t.run((ctx) => ctx.db.get(roomId)))!;

    // 1. Entering the Marquee set: announced, no player loaded.
    let step = await presentAndPass(asAdmin, roomId);
    expect(step.res).toMatchObject({ success: true, enteredSet: "marquee" });
    expect(step.player).toBeUndefined();
    expect((await room()).currentSetId).toBe("marquee");
    expect((await room()).currentPlayerId).toBeUndefined();

    // 2. Marquee's only player.
    step = await presentAndPass(asAdmin, roomId);
    expect(step.player?.name).toBe("M1");

    // 3. Set A announced, then both A players (random order within the set).
    step = await presentAndPass(asAdmin, roomId);
    expect(step.res).toMatchObject({ enteredSet: "a" });
    const aNames = [
      (await presentAndPass(asAdmin, roomId)).player?.name,
      (await presentAndPass(asAdmin, roomId)).player?.name,
    ].sort();
    expect(aNames).toEqual(["A1", "A2"]);

    // 4. Uncategorised players come last and are presented with no announcement.
    step = await presentAndPass(asAdmin, roomId);
    expect(step.player?.name).toBe("Free");

    // 5. Main round over → unsold round exactly as today.
    step = await presentAndPass(asAdmin, roomId);
    expect(step.res).toMatchObject({ enteredUnsoldRound: true });
  });

  test("default (random) order never announces a set", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId } = await setup(t);
    await addPlayers(t, tournamentId, [
      { name: "A1", categoryId: "a" },
      { name: "M1", categoryId: "marquee" },
    ]);

    for (let i = 0; i < 2; i++) {
      const step = await presentAndPass(asAdmin, roomId);
      expect(step.player).toBeDefined();
      expect(step.res).not.toHaveProperty("enteredSet");
    }
    expect((await t.run((ctx) => ctx.db.get(roomId)))?.currentSetId).toBeUndefined();
  });

  test("restartAuction clears the current set", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId } = await setup(t, {
      settings: { presentationOrder: "by_category" },
    });
    await addPlayers(t, tournamentId, [{ name: "M1", categoryId: "marquee" }]);
    await presentAndPass(asAdmin, roomId);
    expect((await t.run((ctx) => ctx.db.get(roomId)))?.currentSetId).toBe("marquee");

    await asAdmin.mutation(api.auctions.restartAuction, { auctionRoomId: roomId });
    expect((await t.run((ctx) => ctx.db.get(roomId)))?.currentSetId).toBeUndefined();
  });
});

describe("tournaments.update — presentationOrder", () => {
  test("saves before the auction and is locked while live", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const waiting = await setup(t, { roomStatus: "waiting" });
    await asAdmin.mutation(api.tournaments.update, {
      id: waiting.tournamentId,
      settings: { ...BASE_SETTINGS, presentationOrder: "by_category" },
    });
    expect(
      (await t.run((ctx) => ctx.db.get(waiting.tournamentId)))?.settings.presentationOrder,
    ).toBe("by_category");

    const t2 = convexTest(schema, modules);
    const live = await setup(t2, { roomStatus: "live" });
    await expect(
      t2.withIdentity(ADMIN_IDENTITY).mutation(api.tournaments.update, {
        id: live.tournamentId,
        settings: { ...BASE_SETTINGS, presentationOrder: "by_category" },
      }),
    ).rejects.toThrow(/locked/);
  });
});
