/// <reference types="vite/client" />
// Destructive actions (AUDIT 2026-10 P0-3, P1-5): refused while the auction is
// live, gated on the typed tournament name, and snapshotted first.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };

/** Tournament with one team, a sold and a pending player, and a room. */
async function setup(
  t: ReturnType<typeof convexTest>,
  roomStatus: "live" | "paused" | "waiting" = "live",
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", { email: ADMIN_IDENTITY.email, role: "admin", createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Test Cup",
      createdBy: adminId,
      status: "active",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 3, basePrice: 100_000 },
      createdAt: now,
      updatedAt: now,
    });
    const teamId = await ctx.db.insert("teams", {
      tournamentId,
      name: "Team A",
      ownerName: "owner",
      purseRemaining: 800_000,
      purseSpent: 200_000,
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      createdAt: now,
      updatedAt: now,
    });
    const player = (name: string, extra: object) =>
      ctx.db.insert("players", {
        tournamentId,
        name,
        age: 30,
        role: "Batter",
        battingBowlingHand: "Right-handed",
        auctionStatus: "pending",
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    const soldId = await player("Sold One", { auctionStatus: "sold", teamId, soldPrice: 200_000 });
    await player("Pending One", {});
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room 1",
      status: roomStatus,
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("bids", {
      auctionRoomId: roomId,
      playerId: soldId,
      teamId,
      amount: 200_000,
      timestamp: now,
      isFinal: true,
    });
    return { tournamentId, teamId, soldId, roomId };
  });
}

async function snapshots(t: ReturnType<typeof convexTest>, tournamentId: Id<"tournaments">) {
  return await t.withIdentity(ADMIN_IDENTITY).query(api.snapshots.listForTournament, { tournamentId });
}

describe("restartAuction (P0-3)", () => {
  test("refuses while the auction is live", async () => {
    const t = convexTest(schema, modules);
    const { roomId, soldId } = await setup(t, "live");

    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.restartAuction, { auctionRoomId: roomId, confirmName: "Test Cup" }),
    ).rejects.toThrow(/Pause the auction/);

    expect((await t.run((ctx) => ctx.db.get(soldId)))?.auctionStatus).toBe("sold");
  });

  test("refuses unless the tournament name is typed", async () => {
    const t = convexTest(schema, modules);
    const { roomId, soldId } = await setup(t, "paused");

    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.restartAuction, { auctionRoomId: roomId, confirmName: "yes" }),
    ).rejects.toThrow(/Type the tournament name/);

    expect((await t.run((ctx) => ctx.db.get(soldId)))?.auctionStatus).toBe("sold");
  });

  test("when paused and confirmed: snapshots everything first, then resets", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, roomId, soldId, teamId } = await setup(t, "paused");

    const res = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.auctions.restartAuction, { auctionRoomId: roomId, confirmName: "  test cup " });

    expect(res).toMatchObject({ success: true });
    expect((await t.run((ctx) => ctx.db.get(soldId)))?.auctionStatus).toBe("pending");

    const [snap] = await snapshots(t, tournamentId);
    expect(snap).toMatchObject({ reason: "before restart_auction", counts: { players: 2, teams: 1, bids: 1 } });
    const data = await t.withIdentity(ADMIN_IDENTITY).query(api.snapshots.getSnapshotData, { snapshotId: snap._id });
    expect(data.players.find((p: { _id: string }) => p._id === soldId)).toMatchObject({ auctionStatus: "sold", soldPrice: 200_000 });
    expect(data.teams.find((tm: { _id: string }) => tm._id === teamId)).toMatchObject({ purseSpent: 200_000 });

    const audit = await t.run(async (ctx) =>
      (await ctx.db.query("auditLogs").collect()).find((l) => l.action === "restart_auction"),
    );
    expect(audit?.newData).toMatchObject({ snapshotId: snap._id });
  });
});

describe("snapshots — access", () => {
  test("only the tournament's staff can read a snapshot", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, roomId } = await setup(t, "paused");
    await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.restartAuction, { auctionRoomId: roomId, confirmName: "Test Cup" });
    const [snap] = await snapshots(t, tournamentId);
    await t.run((ctx) => ctx.db.insert("users", { email: "stranger@test.com", role: "user", createdAt: Date.now() }));
    const stranger = t.withIdentity({ email: "stranger@test.com", subject: "user|2" });

    await expect(stranger.query(api.snapshots.listForTournament, { tournamentId })).rejects.toThrow(/access/);
    await expect(stranger.query(api.snapshots.getSnapshotData, { snapshotId: snap._id })).rejects.toThrow(/access/);
  });
});

describe("deleteTournament (P1-5)", () => {
  test("refuses while the auction is live or paused", async () => {
    for (const status of ["live", "paused"] as const) {
      const t = convexTest(schema, modules);
      const { tournamentId } = await setup(t, status);
      await expect(
        t.withIdentity(ADMIN_IDENTITY).mutation(api.tournaments.deleteTournament, { id: tournamentId, confirmName: "Test Cup" }),
      ).rejects.toThrow(/while the auction is running/);
      expect(await t.run((ctx) => ctx.db.get(tournamentId))).not.toBeNull();
    }
  });

  test("refuses unless the tournament name is typed", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, "waiting");
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.tournaments.deleteTournament, { id: tournamentId, confirmName: "delete" }),
    ).rejects.toThrow(/Type the tournament name/);
    expect(await t.run((ctx) => ctx.db.get(tournamentId))).not.toBeNull();
  });

  test("snapshots first, then removes every child row (payment records are kept)", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, teamId, roomId, soldId } = await setup(t, "waiting");
    await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", { email: "o@test.com", createdAt: now });
      await ctx.db.insert("tournamentStaff", { tournamentId, userId, role: "auctioneer", createdAt: now });
      await ctx.db.insert("teamMembers", { teamId, tournamentId, userId, role: "owner", createdAt: now });
      await ctx.db.insert("teamInvites", { teamId, tournamentId, tokenHash: "h", expiresAt: now, createdBy: userId });
      await ctx.db.insert("bidRequests", { auctionRoomId: roomId, playerId: soldId, teamId, userId, amount: 1, status: "pending", createdAt: now });
      await ctx.db.insert("bidRequestsSeen", { key: "placeBid:x", auctionRoomId: roomId, result: {}, createdAt: now });
      await ctx.db.insert("paymentOrders", { tournamentId, tier: "club", amount: 99_900, razorpayOrderId: "order_1", status: "paid", createdBy: userId, createdAt: now });
    });

    await t.withIdentity(ADMIN_IDENTITY).mutation(api.tournaments.deleteTournament, { id: tournamentId, confirmName: "Test Cup" });

    const left = await t.run(async (ctx) => ({
      tournament: await ctx.db.get(tournamentId),
      staff: await ctx.db.query("tournamentStaff").collect(),
      members: await ctx.db.query("teamMembers").collect(),
      invites: await ctx.db.query("teamInvites").collect(),
      requests: await ctx.db.query("bidRequests").collect(),
      seen: await ctx.db.query("bidRequestsSeen").collect(),
      orders: await ctx.db.query("paymentOrders").collect(),
      snapshots: await ctx.db.query("tournamentSnapshots").collect(),
      audit: (await ctx.db.query("auditLogs").collect()).find((l) => l.action === "delete_tournament"),
    }));
    expect(left.tournament).toBeNull();
    expect([left.staff, left.members, left.invites, left.requests, left.seen].map((rows) => rows.length)).toEqual([0, 0, 0, 0, 0]);
    expect(left.orders).toHaveLength(1);
    expect(left.snapshots).toHaveLength(1);
    expect(left.snapshots[0]).toMatchObject({ reason: "before delete_tournament", tournamentName: "Test Cup" });
    expect(left.audit?.newData).toMatchObject({ snapshotId: left.snapshots[0]._id });
  });
});

describe("audit rows for bulk status changes (P1-6)", () => {
  async function stalledRoom(t: ReturnType<typeof convexTest>) {
    const ids = await setup(t, "live");
    await t.run(async (ctx) => {
      const players = await ctx.db.query("players").collect();
      const pending = players.find((p) => p.auctionStatus === "pending")!;
      await ctx.db.patch(pending._id, { auctionStatus: "unsold" });
      await ctx.db.patch(ids.roomId, { auctionPhase: "unsold", roundNumber: 2, roundStalled: true });
    });
    return ids;
  }

  for (const action of ["end", "finalizeUnsold"] as const) {
    test(`resolveStalledRound "${action}" is audited`, async () => {
      const t = convexTest(schema, modules);
      const { roomId } = await stalledRoom(t);

      await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.resolveStalledRound, { auctionRoomId: roomId, action });

      const audit = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).map((l) => l.action));
      expect(audit).toContain(action === "end" ? "end_auction_stalled_round" : "final_unsold_stalled_round");
    });
  }

  test("startNextPlayer completing the auction is audited", async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await setup(t, "live");
    await t.run(async (ctx) => {
      for (const p of await ctx.db.query("players").collect()) {
        if (p.auctionStatus === "pending") await ctx.db.patch(p._id, { auctionStatus: "final_unsold" });
      }
    });

    const res = await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.startNextPlayer, { auctionRoomId: roomId });

    expect(res).toMatchObject({ completed: true });
    const audit = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).map((l) => l.action));
    expect(audit).toContain("complete_auction");
  });
});
