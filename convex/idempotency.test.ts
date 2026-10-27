/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

// Step 17: a retried console action (same requestId after a reconnect) must
// never apply twice. Fixtures follow auctions.test.ts.
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN = { email: "admin@test.com", subject: "admin|1" };

async function setup(t: ReturnType<typeof convexTest>, bidMode?: "confirm") {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", { email: ADMIN.email, role: "admin", createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Retry Cup",
      createdBy: adminId,
      status: "active",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5, basePrice: 100_000, bidMode },
      createdAt: now,
      updatedAt: now,
    });
    const team = (name: string) =>
      ctx.db.insert("teams", { tournamentId, name, ownerName: "o", purseRemaining: 1_000_000, purseSpent: 0, colorPrimary: "#111111", colorSecondary: "#222222", createdAt: now, updatedAt: now });
    const teamA = await team("A");
    const teamB = await team("B");
    const playerId = await ctx.db.insert("players", {
      tournamentId, name: "On block", age: 25, role: ["Batter"], battingBowlingHand: "Right-handed", auctionStatus: "in_auction", createdAt: now, updatedAt: now,
    });
    const roomId = await ctx.db.insert("auctionRooms", { tournamentId, name: "R", status: "live", currentPlayerId: playerId, createdBy: adminId, createdAt: now, updatedAt: now });
    return { adminId, tournamentId, teamA, teamB, playerId, roomId };
  });
}

const count = (t: ReturnType<typeof convexTest>, table: "liveBids" | "bids" | "bidRequestsSeen") =>
  t.run(async (ctx) => (await ctx.db.query(table).collect()).length);

describe("requestId idempotency", () => {
  test("a replayed placeBid is a no-op that returns the original result", async () => {
    const t = convexTest(schema, modules);
    const { roomId, teamA } = await setup(t);
    const as = t.withIdentity(ADMIN);
    const args = { auctionRoomId: roomId, teamId: teamA, amount: 100_000, requestId: "req-1" };

    const first = await as.mutation(api.auctions.placeBid, args);
    const replay = await as.mutation(api.auctions.placeBid, args);
    expect(first).toMatchObject({ success: true, amount: 100_000 });
    expect(replay).toEqual(first);
    expect(await count(t, "liveBids")).toBe(1);
  });

  test("a failed attempt is remembered too (a retry doesn't flip the outcome)", async () => {
    const t = convexTest(schema, modules);
    const { roomId, teamA } = await setup(t);
    const as = t.withIdentity(ADMIN);
    const low = { auctionRoomId: roomId, teamId: teamA, amount: 50_000, requestId: "req-low" };
    const first = await as.mutation(api.auctions.placeBid, low);
    expect(first).toMatchObject({ success: false });
    expect(await as.mutation(api.auctions.placeBid, low)).toEqual(first);
  });

  test("different requestIds are separate actions; no requestId behaves as before", async () => {
    const t = convexTest(schema, modules);
    const { roomId, teamA, teamB } = await setup(t);
    const as = t.withIdentity(ADMIN);
    await as.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamA, amount: 100_000, requestId: "a" });
    await as.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamB, amount: 125_000, requestId: "b" });
    await as.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamA, amount: 150_000 });
    expect(await count(t, "liveBids")).toBe(3);
    expect(await count(t, "bidRequestsSeen")).toBe(2);
  });

  test("a replayed finalizePlayerSale settles once and debits the purse once", async () => {
    const t = convexTest(schema, modules);
    const { roomId, teamA } = await setup(t);
    const as = t.withIdentity(ADMIN);
    await as.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamA, amount: 200_000 });

    const first = await as.mutation(api.auctions.finalizePlayerSale, { auctionRoomId: roomId, requestId: "fin-1" });
    const replay = await as.mutation(api.auctions.finalizePlayerSale, { auctionRoomId: roomId, requestId: "fin-1" });
    expect(first).toMatchObject({ success: true, sold: true, amount: 200_000 });
    expect(replay).toEqual(first);
    expect(await count(t, "bids")).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(teamA)))?.purseSpent).toBe(200_000);
  });

  test("a replayed acceptBidRequest accepts once", async () => {
    const t = convexTest(schema, modules);
    const { roomId, teamA, playerId, adminId } = await setup(t, "confirm");
    const requestId = await t.run(async (ctx) => {
      await ctx.db.insert("teamMembers", { teamId: teamA, tournamentId: (await ctx.db.get(roomId))!.tournamentId, userId: adminId, role: "owner", createdAt: Date.now() });
      return await ctx.db.insert("bidRequests", { auctionRoomId: roomId, playerId, teamId: teamA, userId: adminId, amount: 100_000, status: "pending", createdAt: Date.now() });
    });
    const as = t.withIdentity(ADMIN);
    const first = await as.mutation(api.auctions.acceptBidRequest, { requestId, idempotencyKey: "acc-1" });
    const replay = await as.mutation(api.auctions.acceptBidRequest, { requestId, idempotencyKey: "acc-1" });
    expect(first).toMatchObject({ success: true });
    expect(replay).toEqual(first);
    expect(await count(t, "liveBids")).toBe(1);
  });

  test("a requestId is scoped to its room and kind", async () => {
    const t = convexTest(schema, modules);
    const { roomId, teamA } = await setup(t);
    const as = t.withIdentity(ADMIN);
    await as.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamA, amount: 100_000, requestId: "same" });
    // Same key on finalize is a different action, not a replay of the bid.
    const fin = await as.mutation(api.auctions.finalizePlayerSale, { auctionRoomId: roomId, requestId: "same" });
    expect(fin).toMatchObject({ success: true, sold: true });
  });

  test("purgeOldRequests drops entries older than a day", async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("bidRequestsSeen", { key: "old", auctionRoomId: roomId as Id<"auctionRooms">, result: {}, createdAt: Date.now() - 2 * 86_400_000 });
      await ctx.db.insert("bidRequestsSeen", { key: "new", auctionRoomId: roomId as Id<"auctionRooms">, result: {}, createdAt: Date.now() });
    });
    expect(await t.mutation(internal.idempotency.purgeOldRequests, {})).toEqual({ deleted: 1 });
    expect(await count(t, "bidRequestsSeen")).toBe(1);
  });
});
