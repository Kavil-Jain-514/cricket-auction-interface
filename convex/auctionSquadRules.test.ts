/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { syncTournamentAuctionCounts } from "./auctionCounts";

// Step 12c: squad rules (max / min per category or role). Fixtures follow
// auctions.test.ts (see there for why _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };

type Settings = Doc<"tournaments">["settings"];
type PlayerFields = Partial<Doc<"players">>;

const MARQUEE = { id: "marquee", name: "Marquee", basePrice: 500_000, order: 0, colour: "#f59e0b" };
const MAX_2_MARQUEE = { id: "max-marquee", categoryId: "marquee", max: 2 };
const MIN_1_MARQUEE = { id: "min-marquee", categoryId: "marquee", min: 1 };
const MIN_1_WK = { id: "min-wk", role: "Wicket Keeper", min: 1 };

const BASE_SETTINGS: Settings = {
  basePurse: 1_000_000,
  minBidIncrement: 25_000,
  bidTimerSeconds: 30,
  maxPlayersPerTeam: 3,
  basePrice: 100_000,
  categories: [MARQUEE],
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
      name: "Squad Cup",
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

/** Insert players directly; `sold` ones are already on a team (purse untouched — irrelevant here). */
async function addPlayer(
  t: ReturnType<typeof convexTest>,
  tournamentId: Id<"tournaments">,
  fields: PlayerFields,
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
  tournamentId: Id<"tournaments">,
  fields: PlayerFields,
) {
  const playerId = await addPlayer(t, tournamentId, { ...fields, auctionStatus: "in_auction" });
  await t.run((ctx) => ctx.db.patch(roomId, { currentPlayerId: playerId }));
  return playerId;
}

describe("max rules", () => {
  test("rejects a bid that would take a team over a max", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA, teamB } = await setup(t, {
      settings: { maxPlayersPerTeam: 5, squadRules: [MAX_2_MARQUEE] },
    });
    for (let i = 0; i < 2; i++) {
      await addPlayer(t, tournamentId, { categoryId: "marquee", auctionStatus: "sold", teamId: teamA, soldPrice: 100_000 });
    }
    // 1L own price keeps the ordinary squad reserve out of the way.
    await putInAuction(t, roomId, tournamentId, { categoryId: "marquee", basePrice: 100_000 });

    const blocked = await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamA, amount: 100_000 });
    expect(blocked).toEqual({ success: false, reason: "Team already has 2 Marquee (max 2)" });

    // Another team is unaffected.
    const ok = await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamB, amount: 100_000 });
    expect(ok).toMatchObject({ success: true });
  });

  test("a non-matching player is unaffected by a full max", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA } = await setup(t, {
      settings: { maxPlayersPerTeam: 5, squadRules: [MAX_2_MARQUEE] },
    });
    for (let i = 0; i < 2; i++) {
      await addPlayer(t, tournamentId, { categoryId: "marquee", auctionStatus: "sold", teamId: teamA, soldPrice: 100_000 });
    }
    await putInAuction(t, roomId, tournamentId, {});

    const ok = await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamA, amount: 100_000 });
    expect(ok).toMatchObject({ success: true });
  });
});

describe("min rules", () => {
  test("an unfilled minimum raises the reserve (roster, paddle limit and placeBid agree)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA } = await setup(t, {
      settings: { squadRules: [MIN_1_MARQUEE] },
    });
    // Pending pool: one Marquee (5L) and one regular (1L).
    await addPlayer(t, tournamentId, { categoryId: "marquee" });
    await addPlayer(t, tournamentId, {});
    const current = await putInAuction(t, roomId, tournamentId, {});

    // Squad 3, empty team: 2 future slots. Without the rule: 10L - 2 x 1L = 8L.
    // With it: one slot at the Marquee's 5L + one at 1L → 10L - 6L = 4L.
    const roster = await t.query(api.auctions.getAuctionRoster, { tournamentId, currentPlayerId: current });
    expect(roster.teams.find((x) => x._id === teamA)?.maxAllowedBid).toBe(400_000);

    const over = await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamA, amount: 425_000 });
    expect(over).toMatchObject({ success: false, maxAllowedBid: 400_000 });
    const ok = await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamA, amount: 400_000 });
    expect(ok).toMatchObject({ success: true });
  });

  test("buying a player who fills the minimum needs no extra reserve", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, roomId, teamA } = await setup(t, {
      settings: { squadRules: [MIN_1_WK] },
    });
    // A pricey pending keeper and a cheap batter: the general reserve is 1L.
    await addPlayer(t, tournamentId, { role: ["Wicket Keeper"], basePrice: 400_000 });
    await addPlayer(t, tournamentId, {});
    const current = await putInAuction(t, roomId, tournamentId, { role: ["Wicket Keeper"] });

    // 10L - 2 x 1L. Had the keeper being bought not counted, it'd be 10L - (4L + 1L).

    const roster = await t.query(api.auctions.getAuctionRoster, { tournamentId, currentPlayerId: current });
    expect(roster.teams.find((x) => x._id === teamA)?.maxAllowedBid).toBe(800_000);
  });

  test("rejects a bid when the last free slot is needed for a minimum", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA } = await setup(t, {
      settings: { maxPlayersPerTeam: 2, squadRules: [MIN_1_WK] },
    });
    await addPlayer(t, tournamentId, { auctionStatus: "sold", teamId: teamA, soldPrice: 100_000 });
    await putInAuction(t, roomId, tournamentId, {});

    const res = await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamA, amount: 100_000 });
    expect(res).toEqual({
      success: false,
      reason: "Team must keep its last slot for 1 WK",
    });
  });

  test("the roster reports rule status per team", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, teamA } = await setup(t, {
      settings: { squadRules: [MIN_1_WK, MAX_2_MARQUEE] },
    });
    await addPlayer(t, tournamentId, { categoryId: "marquee", auctionStatus: "sold", teamId: teamA, soldPrice: 100_000 });

    const roster = await t.query(api.auctions.getAuctionRoster, { tournamentId });
    expect(roster.teams.find((x) => x._id === teamA)?.ruleStatus).toEqual([
      { ruleId: "min-wk", label: "WK", count: 0, min: 1, max: undefined, ok: false },
      { ruleId: "max-marquee", label: "Marquee", count: 1, min: undefined, max: 2, ok: true },
    ]);
  });
});

describe("tournaments.update — squadRules", () => {
  test("saves valid rules before the auction", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { roomStatus: "waiting" });
    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...BASE_SETTINGS, squadRules: [MIN_1_WK, MAX_2_MARQUEE] },
    });
    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.settings.squadRules).toEqual([MIN_1_WK, MAX_2_MARQUEE]);
  });

  test("rejects invalid rules", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { roomStatus: "waiting" });
    for (const bad of [
      [{ id: "x", categoryId: "nope", max: 1 }], // unknown category
      [{ id: "x", role: "Captain", min: 1 }], // unknown role
      [{ id: "x", role: "Bowler", min: 3, max: 2 }], // min > max
      [{ id: "x", role: "Bowler" }], // neither min nor max
      [{ id: "x", role: "Bowler", min: 2 }, { id: "y", role: "Batter", min: 2 }], // mins exceed squad of 3
    ]) {
      await expect(
        asAdmin.mutation(api.tournaments.update, {
          id: tournamentId,
          settings: { ...BASE_SETTINGS, squadRules: bad },
        }),
      ).rejects.toThrow();
    }
  });

  test("squad rules are locked while the auction is live", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { roomStatus: "live" });
    await expect(
      asAdmin.mutation(api.tournaments.update, {
        id: tournamentId,
        settings: { ...BASE_SETTINGS, squadRules: [MIN_1_WK] },
      }),
    ).rejects.toThrow(/locked/);
  });

  test("a category used by a squad rule can't be removed", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, {
      roomStatus: "waiting",
      settings: { squadRules: [MAX_2_MARQUEE] },
    });
    await expect(
      asAdmin.mutation(api.tournaments.update, {
        id: tournamentId,
        settings: { ...BASE_SETTINGS, categories: [] },
      }),
    ).rejects.toThrow(/squad rule/i);
  });
});
