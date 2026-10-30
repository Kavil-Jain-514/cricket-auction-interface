/// <reference types="vite/client" />
// Operations (AUDIT 2026-10 Phase 5): a snapshot when the auction starts,
// restoring a snapshot, and rehearsal mode (practice, then reset).
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { syncTournamentAuctionCounts } from "./auctionCounts";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const OWNER = { email: "owner@test.com", subject: "owner|1" };
const AUCTIONEER = { email: "auc@test.com", subject: "auc|1" };

/** Owner + auctioneer, two teams, three pending players, a waiting room. */
async function setup(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { email: OWNER.email, createdAt: now });
    const aucId = await ctx.db.insert("users", { email: AUCTIONEER.email, createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Ops Cup",
      createdBy: ownerId,
      status: "setup",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 3, basePrice: 100_000, bidTimerSeconds: 0 },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: ownerId, role: "owner", createdAt: now });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: aucId, role: "auctioneer", createdAt: now });
    const teams: Id<"teams">[] = [];
    for (const name of ["A", "B"]) {
      teams.push(
        await ctx.db.insert("teams", {
          tournamentId,
          name,
          ownerName: "o",
          purseRemaining: 1_000_000,
          purseSpent: 0,
          colorPrimary: "#111111",
          colorSecondary: "#222222",
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    for (const name of ["P1", "P2", "P3"]) {
      await ctx.db.insert("players", {
        tournamentId,
        name,
        age: 25,
        role: "Batter",
        battingBowlingHand: "Right-handed",
        auctionStatus: "pending",
        phoneNumber: "9876543210",
        createdAt: now,
        updatedAt: now,
      });
    }
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room",
      status: "waiting",
      createdBy: ownerId,
      createdAt: now,
      updatedAt: now,
    });
    await syncTournamentAuctionCounts(ctx, tournamentId);
    return { tournamentId, teams, roomId };
  });
}

/** Present the next player, bid once for `team`, sell. */
async function sellOne(as: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>, roomId: Id<"auctionRooms">, teamId: Id<"teams">) {
  await as.mutation(api.auctions.startNextPlayer, { auctionRoomId: roomId });
  await as.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId, amount: 200_000 });
  return await as.mutation(api.auctions.finalizePlayerSale, { auctionRoomId: roomId });
}

const state = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => ({
    players: await ctx.db.query("players").collect(),
    teams: await ctx.db.query("teams").collect(),
    rooms: await ctx.db.query("auctionRooms").collect(),
    bids: await ctx.db.query("bids").collect(),
    events: await ctx.db.query("auctionEvents").collect(),
    notifications: await ctx.db.query("notifications").collect(),
    snapshots: await ctx.db.query("tournamentSnapshots").collect(),
  }));

describe("snapshot at auction start", () => {
  test("a fresh start snapshots; resuming does not", async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);

    await asOwner.mutation(api.auctions.startAuction, { auctionRoomId: roomId });
    await asOwner.mutation(api.auctions.pauseAuction, { auctionRoomId: roomId });
    await asOwner.mutation(api.auctions.resumeAuction, { auctionRoomId: roomId });

    const { snapshots } = await state(t);
    expect(snapshots.map((s) => s.reason)).toEqual(["before start_auction"]);
  });
});

describe("restoreSnapshot", () => {
  test("undoes a mistaken restart: sales, purses and history come back", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, teams, roomId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.auctions.startAuction, { auctionRoomId: roomId });
    await sellOne(asOwner, roomId, teams[0]);
    await asOwner.mutation(api.auctions.pauseAuction, { auctionRoomId: roomId });
    await asOwner.mutation(api.auctions.restartAuction, { auctionRoomId: roomId, confirmName: "Ops Cup" });
    const before = (await state(t)).snapshots.find((s) => s.reason === "before restart_auction")!;

    const res = await asOwner.mutation(api.snapshots.restoreSnapshot, { snapshotId: before._id, confirmName: "Ops Cup" });

    expect(res).toMatchObject({ success: true });
    const after = await state(t);
    expect(after.players.filter((p) => p.auctionStatus === "sold")).toHaveLength(1);
    expect(after.teams.find((tm) => tm._id === teams[0])).toMatchObject({ purseSpent: 200_000, purseRemaining: 800_000 });
    expect(after.bids).toHaveLength(1);
    expect(after.events.some((e) => e.type === "player_sold")).toBe(true);
    // Restored rooms never come back running: the auctioneer resumes deliberately.
    expect(after.rooms[0].status).toBe("paused");
    const rec = await asOwner.query(api.auctions.getReconciliation, { tournamentId });
    expect(rec).toEqual({ ok: true, issues: [] });
  });

  test("refuses while live, without the typed name, and for auctioneers", async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.auctions.startAuction, { auctionRoomId: roomId });
    const [snap] = (await state(t)).snapshots;

    await expect(asOwner.mutation(api.snapshots.restoreSnapshot, { snapshotId: snap._id, confirmName: "Ops Cup" })).rejects.toThrow(
      /Pause the auction/,
    );
    await asOwner.mutation(api.auctions.pauseAuction, { auctionRoomId: roomId });
    await expect(asOwner.mutation(api.snapshots.restoreSnapshot, { snapshotId: snap._id, confirmName: "nope" })).rejects.toThrow(
      /Type the tournament name/,
    );
    await expect(
      t.withIdentity(AUCTIONEER).mutation(api.snapshots.restoreSnapshot, { snapshotId: snap._id, confirmName: "Ops Cup" }),
    ).rejects.toThrow(/access/);
  });

  test("a player sold after the snapshot goes back to pending, so the purses still add up", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, teams, roomId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.auctions.startAuction, { auctionRoomId: roomId });
    const [snap] = (await state(t)).snapshots;
    // A player added after the snapshot, then sold.
    await t.run((ctx) =>
      ctx.db.insert("players", {
        tournamentId,
        name: "Late",
        age: 25,
        role: "Batter",
        battingBowlingHand: "Right-handed",
        auctionStatus: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await sellOne(asOwner, roomId, teams[1]);
    await asOwner.mutation(api.auctions.pauseAuction, { auctionRoomId: roomId });

    await asOwner.mutation(api.snapshots.restoreSnapshot, { snapshotId: snap._id, confirmName: "Ops Cup" });

    const after = await state(t);
    expect(after.players.every((p) => p.auctionStatus === "pending" && !p.teamId)).toBe(true);
    expect(await asOwner.query(api.auctions.getReconciliation, { tournamentId })).toEqual({ ok: true, issues: [] });
  });
});

describe("rehearsal mode", () => {
  test("a rehearsal runs like the real thing, sends no WhatsApp, and resets everything when it ends", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, teams, roomId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);

    await asOwner.mutation(api.snapshots.startRehearsal, { auctionRoomId: roomId });
    const live = await t.query(api.auctions.getLiveAuction, { auctionRoomId: roomId });
    expect(live?.auctionRoom).toMatchObject({ status: "live", rehearsal: true });

    const sale = await sellOne(asOwner, roomId, teams[0]);
    expect(sale).toMatchObject({ success: true, sold: true });
    expect((await state(t)).notifications).toEqual([]);

    await asOwner.mutation(api.snapshots.endRehearsal, { auctionRoomId: roomId });

    const after = await state(t);
    expect(after.players.every((p) => p.auctionStatus === "pending" && !p.teamId)).toBe(true);
    expect(after.teams.every((tm) => tm.purseRemaining === 1_000_000 && tm.purseSpent === 0)).toBe(true);
    expect(after.bids).toEqual([]);
    expect(after.events).toEqual([]);
    expect(after.rooms[0]).toMatchObject({ status: "waiting" });
    expect(after.rooms[0].rehearsal).toBeUndefined();
    expect(await asOwner.query(api.auctions.getReconciliation, { tournamentId })).toEqual({ ok: true, issues: [] });
    const audit = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).map((l) => l.action));
    expect(audit).toEqual(expect.arrayContaining(["start_rehearsal", "end_rehearsal"]));
  });

  test("only a waiting room can start a rehearsal, and only owners", async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await setup(t);
    await expect(t.withIdentity(AUCTIONEER).mutation(api.snapshots.startRehearsal, { auctionRoomId: roomId })).rejects.toThrow(
      /access/,
    );
    await t.withIdentity(OWNER).mutation(api.auctions.startAuction, { auctionRoomId: roomId });
    await expect(t.withIdentity(OWNER).mutation(api.snapshots.startRehearsal, { auctionRoomId: roomId })).rejects.toThrow(
      /hasn't started/,
    );
  });
});
