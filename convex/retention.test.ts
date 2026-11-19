/// <reference types="vite/client" />
// Retention (AUDIT 2026-11 PERF-009): what is kept, and for how long.
//   snapshots      the 10 newest per tournament, plus the newest
//                  "before start_auction" and any rehearsal's rewind point
//   owner raises   resolved ones (accepted/rejected/superseded) for 30 days
//   outbox rows    finished WhatsApp/email rows for 90 days (they hold
//                  phone numbers and addresses)
//   audit logs     kept; never deleted automatically
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { takeSnapshot } from "./snapshots";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "o@test.com", createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Cup",
      createdBy: userId,
      status: "active",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 3 },
      createdAt: now,
      updatedAt: now,
    });
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId, name: "Room", status: "waiting", createdBy: userId, createdAt: now, updatedAt: now,
    });
    for (let i = 0; i < 450; i++) {
      // Enough players for several snapshot chunks each.
      await ctx.db.insert("players", {
        tournamentId, name: `P${i}`, role: ["Batter"], battingBowlingHand: "Right-handed",
        auctionStatus: "pending", createdAt: now, updatedAt: now,
      });
    }
    return { userId, tournamentId, roomId };
  });
}

describe("snapshot retention", () => {
  test("keeps the 10 newest, the newest start snapshot and a rehearsal's rewind point", async () => {
    const t = convexTest(schema, modules);
    const { userId, tournamentId, roomId } = await seed(t);
    const take = async (reason: string) => {
      vi.advanceTimersByTime(1_000);
      return await t.run((ctx) => takeSnapshot(ctx, tournamentId, reason, userId));
    };
    const start = await take("before start_auction");
    const rehearsal = await take("before rehearsal");
    await t.run((ctx) => ctx.db.patch(roomId, { rehearsal: true, rehearsalSnapshotId: rehearsal }));
    const old = await take("before restart_auction");
    const recent: Id<"tournamentSnapshots">[] = [];
    for (let i = 0; i < 10; i++) recent.push(await take("before restart_auction"));

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const kept = await t.run((ctx) => ctx.db.query("tournamentSnapshots").collect());
    expect(kept.map((s) => s._id).sort()).toEqual([start, rehearsal, ...recent].sort());
    // The pruned snapshot's chunks went with it.
    const orphanChunks = await t.run((ctx) =>
      ctx.db.query("snapshotChunks").withIndex("by_snapshot", (q) => q.eq("snapshotId", old)).collect(),
    );
    expect(orphanChunks).toEqual([]);
  });
});

describe("daily purges", () => {
  test("resolved owner raises older than 30 days go; pending and recent ones stay", async () => {
    const t = convexTest(schema, modules);
    const { userId, tournamentId, roomId } = await seed(t);
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const teamId = await ctx.db.insert("teams", {
        tournamentId, name: "T", ownerName: "O", purseRemaining: 1, purseSpent: 0,
        colorPrimary: "#111111", colorSecondary: "#222222", createdAt: now, updatedAt: now,
      });
      const playerId = (await ctx.db.query("players").first())!._id;
      const raise = (status: "pending" | "accepted" | "superseded", age: number) =>
        ctx.db.insert("bidRequests", { auctionRoomId: roomId, playerId, teamId, userId, amount: 1, status, createdAt: now - age });
      return {
        oldResolved: await raise("superseded", 31 * DAY),
        oldAccepted: await raise("accepted", 40 * DAY),
        oldPending: await raise("pending", 31 * DAY),
        recent: await raise("accepted", 1 * DAY),
      };
    });

    await t.mutation(internal.ops.purgeOldBidRequests, {});

    const left = await t.run(async (ctx) => (await ctx.db.query("bidRequests").collect()).map((r) => r._id));
    expect(left.sort()).toEqual([ids.oldPending, ids.recent].sort());
  });

  test("finished outbox rows older than 90 days go; queued and recent ones stay", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const payload = { playerName: "P", phoneNumber: "9876543210", tournamentName: "Cup" };
      const wa = (status: "sent" | "failed" | "queued", age: number, key: string) =>
        ctx.db.insert("notifications", {
          kind: "registration_received", dedupeKey: key, tournamentId, payload, status,
          attempts: 1, nextAttemptAt: now - age, createdAt: now - age,
        });
      const mail = (status: "sent" | "queued", age: number, key: string) =>
        ctx.db.insert("emails", {
          kind: "team_signup_invite", dedupeKey: key, tournamentId, to: "x@test.com",
          payload: { tournamentId, tournamentName: "Cup", inviterName: "O" }, status,
          attempts: 1, nextAttemptAt: now - age, createdAt: now - age,
        });
      return {
        waOld: await wa("sent", 91 * DAY, "a"),
        waOldFailed: await wa("failed", 120 * DAY, "b"),
        waQueued: await wa("queued", 91 * DAY, "c"),
        waRecent: await wa("sent", 10 * DAY, "d"),
        mailOld: await mail("sent", 91 * DAY, "e"),
        mailRecent: await mail("sent", 10 * DAY, "f"),
      };
    });

    await t.mutation(internal.ops.purgeOldOutboxRows, {});

    const wa = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).map((r) => r._id));
    const mail = await t.run(async (ctx) => (await ctx.db.query("emails").collect()).map((r) => r._id));
    expect(wa.sort()).toEqual([ids.waQueued, ids.waRecent].sort());
    expect(mail).toEqual([ids.mailRecent]);
  });
});
