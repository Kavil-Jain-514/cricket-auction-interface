/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { syncTournamentAuctionCounts } from "./auctionCounts";

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

  // P0-1: The auction is auctioneer-paced (a human calls the bid and finalizes
  // manually), so a legitimately-called bid that arrives after the display timer
  // has elapsed must still be accepted. The server no longer gates bids on
  // `bidTimerEndsAt`; the timer is a UI countdown only.
  test("accepts a valid bid even after the timer window has elapsed", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA } = await setup(t);
    await putPlayerInAuction(t, {
      tournamentId,
      roomId,
      bidTimerEndsAt: Date.now() - 60_000, // timer elapsed a minute ago
    });

    const res = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 100_000,
    });
    expect(res).toMatchObject({ success: true });
  });

  // Core correctness claim from the audit: concurrent bids can't both win at the
  // same price. Whichever commits first sets currentBid; the other then fails the
  // min-increment check. Exactly one bid is accepted and recorded.
  test("two concurrent bids at the same amount: exactly one is accepted", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA, teamB } = await setup(t);
    const playerId = await putPlayerInAuction(t, { tournamentId, roomId });

    const amount = 100_000; // == base price: first is legal, a second at the same amount is not
    const [r1, r2] = await Promise.all([
      asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamA, amount }),
      asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamB, amount }),
    ]);

    const accepted = [r1, r2].filter((r) => r?.success).length;
    expect(accepted).toBe(1);

    // Exactly one live bid, at `amount`.
    await t.run(async (ctx) => {
      const bids = await ctx.db
        .query("liveBids")
        .withIndex("by_player", (q) => q.eq("playerId", playerId))
        .collect();
      expect(bids).toHaveLength(1);
      expect(bids[0].amount).toBe(amount);
    });
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

/** Insert a non-current player (e.g. a pending pool player or a sold squad member). */
async function insertPlayer(
  t: ReturnType<typeof convexTest>,
  args: {
    tournamentId: Id<"tournaments">;
    auctionStatus: "pending" | "sold" | "unsold";
    basePrice?: number;
    teamId?: Id<"teams">;
    soldPrice?: number;
  },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("players", {
      tournamentId: args.tournamentId,
      name: "Pool Player",
      age: 25,
      role: "Bowler",
      battingBowlingHand: "Right-handed",
      basePrice: args.basePrice,
      auctionStatus: args.auctionStatus,
      teamId: args.teamId,
      soldPrice: args.soldPrice,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("placeBid — squad and max-bid rules", () => {
  test("rejects a bid from a team whose squad is already full", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA } = await setup(t, {
      maxPlayersPerTeam: 1,
    });
    await insertPlayer(t, {
      tournamentId,
      auctionStatus: "sold",
      teamId: teamA,
      soldPrice: 100_000,
    });
    await putPlayerInAuction(t, { tournamentId, roomId });

    const res = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 100_000,
    });
    expect(res).toMatchObject({ success: false, reason: "Squad is full" });
  });

  test("a bid at the displayed maxAllowedBid is accepted; one increment above is rejected", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    // Purse 10L, 3-player squads, ₹5L player on the block, ₹1L player still pending.
    // Future slots are reserved at the cheapest pending base price (₹1L), so
    // max = 10L - 2 × 1L = 8L. (Reserving at the ₹5L current price would give 0.)
    const { tournamentId, roomId, teamA } = await setup(t, {
      basePurse: 1_000_000,
      maxPlayersPerTeam: 3,
      basePrice: 100_000,
      minBidIncrement: 25_000,
    });
    await insertPlayer(t, {
      tournamentId,
      auctionStatus: "pending",
      basePrice: 100_000,
    });
    const playerId = await putPlayerInAuction(t, {
      tournamentId,
      roomId,
      basePrice: 500_000,
    });
    await t.run((ctx) => syncTournamentAuctionCounts(ctx, tournamentId));

    const roster = await t.query(api.auctions.getAuctionRoster, {
      tournamentId,
      currentPlayerId: playerId,
    });
    const displayedMax = roster.teams.find((tm) => tm._id === teamA)!
      .maxAllowedBid;
    expect(displayedMax).toBe(800_000);

    const over = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: displayedMax + 25_000,
    });
    expect(over).toMatchObject({ success: false, maxAllowedBid: displayedMax });
    expect(over.reason).toContain("Max allowed: ₹8.00L");

    const atMax = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: displayedMax,
    });
    expect(atMax).toMatchObject({ success: true });
  });

  test("rejects a team from another tournament", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, adminId } = await setup(t);
    const playerId = await putPlayerInAuction(t, { tournamentId, roomId });
    const foreignTeam = await t.run(async (ctx) => {
      const now = Date.now();
      const otherTournamentId = await ctx.db.insert("tournaments", {
        name: "Other Cup",
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
      return await ctx.db.insert("teams", {
        tournamentId: otherTournamentId,
        name: "Outsiders",
        ownerName: "owner",
        purseRemaining: 1_000_000,
        purseSpent: 0,
        colorPrimary: "#333333",
        colorSecondary: "#444444",
        createdAt: now,
        updatedAt: now,
      });
    });

    const res = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: foreignTeam,
      amount: 100_000,
    });
    expect(res).toMatchObject({ success: false });

    await t.run(async (ctx) => {
      const bids = await ctx.db
        .query("liveBids")
        .withIndex("by_player", (q) => q.eq("playerId", playerId))
        .collect();
      expect(bids).toHaveLength(0);
    });
  });
});

describe("admin corrections — squad reserve", () => {
  test("updatePlayerStatus → sold reserves at the cheapest pending base price", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    // Tournament base ₹5L, but a ₹1L player is still pending. Selling to a
    // 3-player squad at ₹8L leaves ₹2L for 2 slots: fine at ₹1L each, while the
    // old tournament-base reserve (2 × ₹5L) would have refused it.
    const { tournamentId, teamA } = await setup(t, {
      basePurse: 1_000_000,
      maxPlayersPerTeam: 3,
      basePrice: 500_000,
    });
    await insertPlayer(t, {
      tournamentId,
      auctionStatus: "pending",
      basePrice: 100_000,
    });
    const unsoldId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "unsold",
    });
    await t.run((ctx) => syncTournamentAuctionCounts(ctx, tournamentId));

    await asAdmin.mutation(api.admin.updatePlayerStatus, {
      playerId: unsoldId,
      newStatus: "sold",
      teamId: teamA,
      soldPrice: 800_000,
    });

    await t.run(async (ctx) => {
      const team = await ctx.db.get(teamA);
      expect(team?.purseRemaining).toBe(200_000);
      expect(team?.purseSpent).toBe(800_000);
    });
  });

  test("updatePlayerStatus → sold refuses a team whose squad is full", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teamA } = await setup(t, { maxPlayersPerTeam: 1 });
    await insertPlayer(t, {
      tournamentId,
      auctionStatus: "sold",
      teamId: teamA,
      soldPrice: 100_000,
    });
    const unsoldId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "unsold",
    });

    await expect(
      asAdmin.mutation(api.admin.updatePlayerStatus, {
        playerId: unsoldId,
        newStatus: "sold",
        teamId: teamA,
        soldPrice: 100_000,
      }),
    ).rejects.toThrow(/squad is full/i);
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

  // P1-2: the unsold sale event carries the resolved base price so the viewer
  // popup query (getLatestSaleEvent) does not need to read the per-bid-mutated
  // room doc. Verify the amount surfaces correctly from the event data.
  test("getLatestSaleEvent reports the unsold base price without the room read", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId } = await setup(t, { basePrice: 100_000 });
    await putPlayerInAuction(t, { tournamentId, roomId }); // player inherits 100k

    await asAdmin.mutation(api.auctions.finalizePlayerSale, { auctionRoomId: roomId });

    const ev = await t.query(api.auctions.getLatestSaleEvent, { auctionRoomId: roomId });
    expect(ev).toMatchObject({ sold: false, amount: 100_000 });
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

describe("public viewer — no sign-in", () => {
  test("every viewer query works with no identity and never returns a phone number", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, roomId, teamA } = await setup(t);
    const soldId = await insertPlayer(t, {
      tournamentId,
      auctionStatus: "sold",
      teamId: teamA,
      soldPrice: 100_000,
    });
    const playerId = await putPlayerInAuction(t, { tournamentId, roomId });
    await t.run(async (ctx) => {
      await ctx.db.patch(soldId, { phoneNumber: "+91-9000000001" });
      await ctx.db.patch(playerId, { phoneNumber: "+91-9000000002" });
    });
    await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 100_000,
    });
    await asAdmin.mutation(api.auctions.finalizePlayerSale, { auctionRoomId: roomId });
    const nextId = await putPlayerInAuction(t, { tournamentId, roomId });
    await t.run(async (ctx) => {
      await ctx.db.patch(nextId, { phoneNumber: "+91-9000000003" });
    });

    // `t` without withIdentity is exactly a signed-out browser.
    const live = await t.query(api.auctions.getLiveAuction, { auctionRoomId: roomId });
    const roster = await t.query(api.auctions.getAuctionRoster, {
      tournamentId,
      currentPlayerId: live?.auctionRoom.currentPlayerId,
    });
    const sale = await t.query(api.auctions.getLatestSaleEvent, { auctionRoomId: roomId });
    const history = await t.query(api.auctions.getAuctionHistory, { tournamentId });

    expect(live?.auctionRoom.currentPlayerId).toBe(nextId);
    expect(roster?.currentPlayer?._id).toBe(nextId);
    expect(sale).toMatchObject({ sold: true, amount: 100_000 });
    expect(history.sold).toHaveLength(2);

    const payload = JSON.stringify({ live, roster, sale, history });
    expect(payload).not.toContain("phoneNumber");
    expect(payload).not.toContain("+91-900000000");
  });

  const SIGNED_IN_USER = { email: "viewer@test.com", subject: "user|viewer" };
  const callers = [
    { label: "an anonymous caller", identity: null },
    { label: "a signed-in non-admin", identity: SIGNED_IN_USER },
  ] as const;
  const adminMutations = [
    "placeBid",
    "finalizePlayerSale",
    "startNextPlayer",
    "restartAuction",
  ] as const;

  for (const { label, identity } of callers) {
    for (const name of adminMutations) {
      test(`${name} rejects ${label} and changes nothing`, async () => {
        const t = convexTest(schema, modules);
        const asAdmin = t.withIdentity(ADMIN_IDENTITY);
        const { tournamentId, roomId, teamA } = await setup(t);
        const playerId = await putPlayerInAuction(t, { tournamentId, roomId });
        await insertPlayer(t, { tournamentId, auctionStatus: "pending" });
        await asAdmin.mutation(api.auctions.placeBid, {
          auctionRoomId: roomId,
          teamId: teamA,
          amount: 100_000,
        });
        if (identity) {
          await t.run(async (ctx) => {
            await ctx.db.insert("users", {
              email: identity.email,
              role: "user",
              createdAt: Date.now(),
            });
          });
        }
        const caller = identity ? t.withIdentity(identity) : t;
        const snapshot = () =>
          t.run(async (ctx) => ({
            room: await ctx.db.get(roomId),
            teams: await ctx.db.query("teams").collect(),
            players: await ctx.db.query("players").collect(),
            bids: await ctx.db.query("liveBids").collect(),
            events: await ctx.db.query("auctionEvents").collect(),
          }));
        const before = await snapshot();

        const call =
          name === "placeBid"
            ? caller.mutation(api.auctions.placeBid, {
                auctionRoomId: roomId,
                teamId: teamA,
                amount: 125_000,
              })
            : caller.mutation(api.auctions[name], { auctionRoomId: roomId });

        await expect(call).rejects.toThrow(
          identity ? "Admin access required" : "Not authenticated",
        );
        expect(await snapshot()).toEqual(before);
        expect(before.room?.currentPlayerId).toBe(playerId);
      });
    }
  }
});
