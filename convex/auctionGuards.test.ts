/// <reference types="vite/client" />
// Expected-state guards on console actions (AUDIT 2026-10 P0-1, P0-2, P1-1).
// A console action carries the player and current bid it was based on, so a
// stale call (a second console, a double tap, a mutation Convex replays after
// a reconnect) is refused instead of landing on whatever is up now.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };

/** Admin, tournament, two teams and a live room (as setup() in auctions.test.ts). */
async function setup(t: ReturnType<typeof convexTest>) {
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

async function addPlayer(
  t: ReturnType<typeof convexTest>,
  tournamentId: Id<"tournaments">,
  name: string,
  auctionStatus: "pending" | "in_auction" = "pending",
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("players", {
      tournamentId,
      name,
      age: 30,
      role: "Batter",
      battingBowlingHand: "Right-handed",
      auctionStatus,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

/** Put `name` on the block. */
async function putUp(
  t: ReturnType<typeof convexTest>,
  ids: { tournamentId: Id<"tournaments">; roomId: Id<"auctionRooms"> },
  name: string,
) {
  const playerId = await addPlayer(t, ids.tournamentId, name, "in_auction");
  await t.run((ctx) => ctx.db.patch(ids.roomId, { currentPlayerId: playerId }));
  return playerId;
}

async function liveBids(t: ReturnType<typeof convexTest>, playerId: Id<"players">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("liveBids").collect()).filter((b) => b.playerId === playerId),
  );
}

describe("placeBid — expected player and price (P0-1)", () => {
  test("a bid meant for the previous player never lands on the next one", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const ids = await setup(t);
    const x = await putUp(t, ids, "X");
    // X is sold elsewhere and Y comes up before this (held) bid arrives.
    await t.run((ctx) => ctx.db.patch(x, { auctionStatus: "unsold" }));
    const y = await putUp(t, ids, "Y");

    const res = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: ids.roomId,
      teamId: ids.teamA,
      amount: 100_000,
      expectedPlayerId: x,
      expectedCurrentBid: null,
    });

    expect(res).toMatchObject({ success: false, reason: expect.stringContaining("Player changed") });
    expect(await liveBids(t, y)).toHaveLength(0);
  });

  test("a bid based on a stale price is refused with the current price", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const ids = await setup(t);
    const x = await putUp(t, ids, "X");
    await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: ids.roomId,
      teamId: ids.teamB,
      amount: 100_000,
    });
    await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: ids.roomId,
      teamId: ids.teamA,
      amount: 125_000,
    });

    // Based on the ₹1,00,000 price, a valid-looking ₹1,50,000 jump.
    const res = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: ids.roomId,
      teamId: ids.teamB,
      amount: 150_000,
      expectedPlayerId: x,
      expectedCurrentBid: 100_000,
    });

    expect(res).toEqual({ success: false, reason: "Price changed, current bid is ₹1,25,000" });
    expect(await liveBids(t, x)).toHaveLength(2);
  });

  test("a bid on the price the console saw is accepted", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const ids = await setup(t);
    const x = await putUp(t, ids, "X");

    const first = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: ids.roomId,
      teamId: ids.teamA,
      amount: 100_000,
      expectedPlayerId: x,
      expectedCurrentBid: null,
    });
    const second = await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: ids.roomId,
      teamId: ids.teamB,
      amount: 125_000,
      expectedPlayerId: x,
      expectedCurrentBid: 100_000,
    });

    expect(first).toMatchObject({ success: true });
    expect(second).toMatchObject({ success: true });
  });

  test("race: two consoles bid on the same price, exactly one lands", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const ids = await setup(t);
    const x = await putUp(t, ids, "X");

    const results = await Promise.all(
      [ids.teamA, ids.teamB].map((teamId) =>
        asAdmin.mutation(api.auctions.placeBid, {
          auctionRoomId: ids.roomId,
          teamId,
          amount: 150_000,
          expectedPlayerId: x,
          expectedCurrentBid: null,
        }),
      ),
    );

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(await liveBids(t, x)).toHaveLength(1);
  });
});

describe("finalizePlayerSale — expected player and price (P0-2)", () => {
  test("a stale Sell never closes the next player", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const ids = await setup(t);
    const x = await putUp(t, ids, "X");
    await t.run((ctx) => ctx.db.patch(x, { auctionStatus: "unsold" }));
    const y = await putUp(t, ids, "Y");

    const res = await asAdmin.mutation(api.auctions.finalizePlayerSale, {
      auctionRoomId: ids.roomId,
      expectedPlayerId: x,
      expectedCurrentBid: null,
    });

    expect(res).toMatchObject({ success: false, reason: expect.stringContaining("Player changed") });
    const after = await t.run(async (ctx) => ({
      y: await ctx.db.get(y),
      room: await ctx.db.get(ids.roomId),
    }));
    expect(after.y?.auctionStatus).toBe("in_auction");
    expect(after.room?.currentPlayerId).toBe(y);
  });

  test("a Sell based on an older price is refused (a bid arrived mid-sell)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const ids = await setup(t);
    const x = await putUp(t, ids, "X");
    await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: ids.roomId,
      teamId: ids.teamA,
      amount: 100_000,
    });
    await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: ids.roomId,
      teamId: ids.teamB,
      amount: 125_000,
    });

    const res = await asAdmin.mutation(api.auctions.finalizePlayerSale, {
      auctionRoomId: ids.roomId,
      expectedPlayerId: x,
      expectedCurrentBid: 100_000,
    });

    expect(res).toEqual({ success: false, reason: "Price changed, current bid is ₹1,25,000" });
    const player = await t.run((ctx) => ctx.db.get(x));
    expect(player?.auctionStatus).toBe("in_auction");
  });

  test("race: sell vs bid — the sale settles at exactly the price it was based on, or not at all", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const ids = await setup(t);
    const x = await putUp(t, ids, "X");
    await asAdmin.mutation(api.auctions.placeBid, {
      auctionRoomId: ids.roomId,
      teamId: ids.teamA,
      amount: 100_000,
    });

    const [sale, bid] = await Promise.all([
      asAdmin.mutation(api.auctions.finalizePlayerSale, {
        auctionRoomId: ids.roomId,
        expectedPlayerId: x,
        expectedCurrentBid: 100_000,
      }),
      asAdmin.mutation(api.auctions.placeBid, {
        auctionRoomId: ids.roomId,
        teamId: ids.teamB,
        amount: 125_000,
        expectedPlayerId: x,
        expectedCurrentBid: 100_000,
      }),
    ]);

    const state = await t.run(async (ctx) => ({
      player: await ctx.db.get(x),
      a: await ctx.db.get(ids.teamA),
      b: await ctx.db.get(ids.teamB),
    }));
    if (sale.success) {
      // Sale first: the bid found no player and changed nothing.
      expect(bid.success).toBe(false);
      expect(state.player).toMatchObject({ auctionStatus: "sold", teamId: ids.teamA, soldPrice: 100_000 });
      expect(state.a?.purseSpent).toBe(100_000);
      expect(state.b?.purseSpent).toBe(0);
    } else {
      // Bid first: the sale saw a different price and changed nothing.
      expect(bid.success).toBe(true);
      expect(state.player?.auctionStatus).toBe("in_auction");
      expect(state.a?.purseSpent).toBe(0);
      expect(state.b?.purseSpent).toBe(0);
    }
  });
});

describe("other console actions — expected state (P0-2, P1-1)", () => {
  test("markPlayerFinalUnsold refuses a player that is no longer up", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const ids = await setup(t);
    const x = await putUp(t, ids, "X");
    await t.run((ctx) => ctx.db.patch(x, { auctionStatus: "unsold" }));
    const y = await putUp(t, ids, "Y");

    const res = await asAdmin.mutation(api.auctions.markPlayerFinalUnsold, {
      auctionRoomId: ids.roomId,
      expectedPlayerId: x,
    });

    expect(res).toMatchObject({ success: false });
    expect((await t.run((ctx) => ctx.db.get(y)))?.auctionStatus).toBe("in_auction");
  });

  test("a double revert removes one bid, not two", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const ids = await setup(t);
    const x = await putUp(t, ids, "X");
    for (const [teamId, amount] of [
      [ids.teamA, 100_000],
      [ids.teamB, 125_000],
    ] as const) {
      await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: ids.roomId, teamId, amount });
    }

    const guard = { auctionRoomId: ids.roomId, expectedPlayerId: x, expectedCurrentBid: 125_000 };
    const first = await asAdmin.mutation(api.auctions.revertLastBid, guard);
    const second = await asAdmin.mutation(api.auctions.revertLastBid, guard);

    expect(first).toMatchObject({ success: true });
    expect(second).toEqual({ success: false, reason: "Price changed, current bid is ₹1,00,000" });
    expect(await liveBids(t, x)).toHaveLength(1);
  });

  test("a held revert never deletes a bid on the next player", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const ids = await setup(t);
    const x = await putUp(t, ids, "X");
    await t.run((ctx) => ctx.db.patch(x, { auctionStatus: "unsold" }));
    const y = await putUp(t, ids, "Y");
    await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: ids.roomId, teamId: ids.teamA, amount: 100_000 });

    const res = await asAdmin.mutation(api.auctions.revertLastBid, {
      auctionRoomId: ids.roomId,
      expectedPlayerId: x,
      expectedCurrentBid: 100_000,
    });

    expect(res).toMatchObject({ success: false });
    expect(await liveBids(t, y)).toHaveLength(1);
  });

  test("restartCurrentPlayer and clearCurrentPlayerBids refuse a player that is no longer up", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const ids = await setup(t);
    const x = await putUp(t, ids, "X");
    await t.run((ctx) => ctx.db.patch(x, { auctionStatus: "unsold" }));
    const y = await putUp(t, ids, "Y");
    await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: ids.roomId, teamId: ids.teamA, amount: 100_000 });

    const restart = await asAdmin.mutation(api.auctions.restartCurrentPlayer, {
      auctionRoomId: ids.roomId,
      expectedPlayerId: x,
    });
    const clear = await asAdmin.mutation(api.admin.clearCurrentPlayerBids, {
      auctionRoomId: ids.roomId,
      reason: "mistake",
      expectedPlayerId: x,
    });

    expect(restart).toMatchObject({ success: false });
    expect(clear).toMatchObject({ success: false });
    expect(await liveBids(t, y)).toHaveLength(1);
  });

  test("race: double next-player loads exactly one player", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const ids = await setup(t);
    await addPlayer(t, ids.tournamentId, "P1");
    await addPlayer(t, ids.tournamentId, "P2");

    const results = await Promise.all([
      asAdmin.mutation(api.auctions.startNextPlayer, { auctionRoomId: ids.roomId }),
      asAdmin.mutation(api.auctions.startNextPlayer, { auctionRoomId: ids.roomId }),
    ]);

    expect(results.filter((r) => r.success && "player" in r)).toHaveLength(1);
    const inAuction = await t.run(async (ctx) =>
      (await ctx.db.query("players").collect()).filter((p) => p.auctionStatus === "in_auction"),
    );
    expect(inAuction).toHaveLength(1);
  });
});
