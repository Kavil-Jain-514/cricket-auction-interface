/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

// Discover the Convex function modules for the test runtime (this file lives in
// the convex/ root, so the glob resolves against the functions directory).
// Exclude test files so convex-test doesn't try to register them as functions.
// NOTE: `_generated` MUST stay included — convex-test uses it to locate the
// module root and errors if it's missing.
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };

interface SetupOptions {
  basePurse?: number;
  minBidIncrement?: number;
  maxPlayersPerTeam?: number;
  basePrice?: number;
  bidTimerSeconds?: number;
}

/**
 * Seed an admin user + active tournament with two teams and a live auction room.
 * Data is inserted directly (bypassing mutations) so each test starts from a
 * deterministic state.
 */
async function setup(
  t: ReturnType<typeof convexTest>,
  opts: SetupOptions = {},
) {
  const {
    basePurse = 1_000_000,
    minBidIncrement = 25_000,
    maxPlayersPerTeam = 3,
    basePrice = 100_000,
    bidTimerSeconds = 30,
  } = opts;

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
        basePurse,
        minBidIncrement,
        bidTimerSeconds,
        maxPlayersPerTeam,
        basePrice,
      },
      createdAt: now,
      updatedAt: now,
    });
    const mkTeam = (name: string) =>
      ctx.db.insert("teams", {
        tournamentId,
        name,
        ownerName: "owner",
        purseRemaining: basePurse,
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
      status: "live",
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    return { adminId, tournamentId, teamA, teamB, roomId };
  });
}

/** Insert a player and mark it as the current in-auction player for the room. */
async function putPlayerInAuction(
  t: ReturnType<typeof convexTest>,
  args: {
    tournamentId: Id<"tournaments">;
    roomId: Id<"auctionRooms">;
    basePrice?: number;
    bidTimerEndsAt?: number;
  },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const playerId = await ctx.db.insert("players", {
      tournamentId: args.tournamentId,
      name: "Virat",
      age: 30,
      role: "Batter",
      battingBowlingHand: "Right-handed",
      basePrice: args.basePrice,
      auctionStatus: "in_auction",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.roomId, {
      currentPlayerId: playerId,
      bidTimerEndsAt: args.bidTimerEndsAt ?? now + 30_000,
      updatedAt: now,
    });
    return playerId;
  });
}

describe("placeBid — bid validation", () => {
  test("rejects a first bid below the player's base price", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA } = await setup(t);
    await putPlayerInAuction(t, { tournamentId, roomId });

    const res = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 50_000, // below base price of 100k
    });

    expect(res).toMatchObject({ success: false });
  });

  test("rejects a raise below currentBid + minBidIncrement", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA, teamB } = await setup(t);
    await putPlayerInAuction(t, { tournamentId, roomId });

    const first = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 100_000,
    });
    expect(first).toMatchObject({ success: true });

    // Min next bid is 125k (100k + 25k increment); 110k must be rejected.
    const low = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamB,
      amount: 110_000,
    });
    expect(low).toMatchObject({ success: false });

    const ok = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamB,
      amount: 125_000,
    });
    expect(ok).toMatchObject({ success: true });
  });

  test("rejects a bid exceeding the team's purse", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    // Single-player squad so squad-completion reserve is not the limiting factor.
    const { tournamentId, roomId, teamA } = await setup(t, {
      basePurse: 200_000,
      maxPlayersPerTeam: 1,
    });
    await putPlayerInAuction(t, { tournamentId, roomId });

    const res = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 250_000, // more than the 200k purse
    });
    expect(res).toMatchObject({ success: false });
  });

  test("enforces squad-completion reserve (purse minus future base prices)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    // maxPlayersPerTeam=3, basePrice=100k, purse=1M → team needs 3 players.
    // Reserve for the other 2 = 200k → maxAllowedBid = 800k.
    const { tournamentId, roomId, teamA } = await setup(t, {
      basePurse: 1_000_000,
      maxPlayersPerTeam: 3,
      basePrice: 100_000,
    });
    await putPlayerInAuction(t, { tournamentId, roomId });

    const tooHigh = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 900_000, // above the 800k cap
    });
    expect(tooHigh).toMatchObject({ success: false });

    const atCap = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 800_000, // exactly at the cap
    });
    expect(atCap).toMatchObject({ success: true });
  });

  test("rejects bids after the timer has expired", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA } = await setup(t);
    await putPlayerInAuction(t, {
      tournamentId,
      roomId,
      bidTimerEndsAt: Date.now() - 1_000, // already expired
    });

    const res = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 100_000,
    });
    expect(res).toMatchObject({ success: false });
  });

  test("rejects bids from non-admins", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, roomId, teamA } = await setup(t);
    await putPlayerInAuction(t, { tournamentId, roomId });

    // No identity → requireAdmin throws.
    await expect(
      t.mutation(api.auctions.placeBid, {
        auctionRoomId: roomId,
        teamId: teamA,
        amount: 100_000,
      }),
    ).rejects.toThrow();
  });
});

describe("finalizePlayerSale — purse settlement", () => {
  test("SOLD: deducts the winning bid from the team purse and assigns the player", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA } = await setup(t);
    const playerId = await putPlayerInAuction(t, { tournamentId, roomId });

    await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 100_000,
    });

    const res = await asAdmin.mutation(api.auctions.finalizePlayerSale, {
      auctionRoomId: roomId,
    });
    expect(res).toMatchObject({ success: true, sold: true, amount: 100_000 });

    await t.run(async (ctx) => {
      const team = await ctx.db.get(teamA);
      const player = await ctx.db.get(playerId);
      const room = await ctx.db.get(roomId);
      expect(team?.purseRemaining).toBe(900_000);
      expect(team?.purseSpent).toBe(100_000);
      expect(player?.auctionStatus).toBe("sold");
      expect(player?.soldPrice).toBe(100_000);
      expect(player?.teamId).toBe(teamA);
      // Current player is cleared after finalization.
      expect(room?.currentPlayerId).toBeUndefined();
      // Winning bid archived to permanent bids table.
      const archived = await ctx.db
        .query("bids")
        .withIndex("by_player", (q) => q.eq("playerId", playerId))
        .collect();
      expect(archived).toHaveLength(1);
      expect(archived[0].isFinal).toBe(true);
    });
  });

  test("UNSOLD: no bids leaves purses untouched and marks the player unsold", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA } = await setup(t);
    const playerId = await putPlayerInAuction(t, { tournamentId, roomId });

    const res = await asAdmin.mutation(api.auctions.finalizePlayerSale, {
      auctionRoomId: roomId,
    });
    expect(res).toMatchObject({ success: true, sold: false });

    await t.run(async (ctx) => {
      const team = await ctx.db.get(teamA);
      const player = await ctx.db.get(playerId);
      expect(team?.purseRemaining).toBe(1_000_000);
      expect(team?.purseSpent).toBe(0);
      expect(player?.auctionStatus).toBe("unsold");
      expect(player?.teamId).toBeUndefined();
    });
  });
});

describe("startNextPlayer — guards", () => {
  test("refuses to load a new player while one is already in auction", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId } = await setup(t);
    const playerId = await putPlayerInAuction(t, { tournamentId, roomId });

    const res = await asAdmin.mutation(api.auctions.startNextPlayer, {
      auctionRoomId: roomId,
    });
    expect(res).toMatchObject({ success: false });

    // The in-auction player must be untouched (not abandoned).
    await t.run(async (ctx) => {
      const player = await ctx.db.get(playerId);
      const room = await ctx.db.get(roomId);
      expect(player?.auctionStatus).toBe("in_auction");
      expect(room?.currentPlayerId).toBe(playerId);
    });
  });

  test("completes the auction when no players remain", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { roomId } = await setup(t);

    const res = await asAdmin.mutation(api.auctions.startNextPlayer, {
      auctionRoomId: roomId,
    });
    expect(res).toMatchObject({ success: true, completed: true });

    await t.run(async (ctx) => {
      const room = await ctx.db.get(roomId);
      expect(room?.status).toBe("completed");
    });
  });

  test("moves a pending player into auction and starts the timer", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId } = await setup(t);
    const playerId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("players", {
        tournamentId,
        name: "Rohit",
        age: 33,
        role: "Batter",
        battingBowlingHand: "Right-handed",
        auctionStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });
    });

    const res = await asAdmin.mutation(api.auctions.startNextPlayer, {
      auctionRoomId: roomId,
    });
    expect(res).toMatchObject({ success: true });

    await t.run(async (ctx) => {
      const player = await ctx.db.get(playerId);
      const room = await ctx.db.get(roomId);
      expect(player?.auctionStatus).toBe("in_auction");
      expect(room?.currentPlayerId).toBe(playerId);
      expect(room?.bidTimerEndsAt).toBeGreaterThan(Date.now());
    });
  });
});
