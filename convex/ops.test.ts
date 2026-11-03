/// <reference types="vite/client" />
// Live-ops panel (AUDIT 2026-10 Phase 5, D2): presence for consoles and owner
// paddles (not viewers), client error reports, webhook log, and one
// super-admin overview.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const SUPER = { email: "super@test.com", subject: "super|1" };
const ORG = { email: "org@test.com", subject: "org|1" };
const OWNER = { email: "owner@test.com", subject: "owner|1" };
const STRANGER = { email: "stranger@test.com", subject: "x|1" };
const SECRET = "whsec_test";

async function setup(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", { email: SUPER.email, role: "admin", createdAt: now });
    const orgId = await ctx.db.insert("users", { email: ORG.email, createdAt: now });
    const ownerId = await ctx.db.insert("users", { email: OWNER.email, createdAt: now });
    await ctx.db.insert("users", { email: STRANGER.email, createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Ops Cup",
      createdBy: orgId,
      status: "active",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 3 },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: orgId, role: "owner", createdAt: now });
    const teamId = await ctx.db.insert("teams", {
      tournamentId,
      name: "A",
      ownerName: "o",
      purseRemaining: 1_000_000,
      purseSpent: 0,
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("teamMembers", { teamId, tournamentId, userId: ownerId, role: "owner", createdAt: now });
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room",
      status: "live",
      createdBy: orgId,
      createdAt: now,
      updatedAt: now,
    });
    return { tournamentId, roomId };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});

describe("presence (consoles and owner paddles only)", () => {
  test("heartbeats show who is connected, by role, and go stale after 75 s", async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await setup(t);
    await t.withIdentity(ORG).mutation(api.ops.heartbeat, { auctionRoomId: roomId });
    await t.withIdentity(OWNER).mutation(api.ops.heartbeat, { auctionRoomId: roomId });
    await t.withIdentity(STRANGER).mutation(api.ops.heartbeat, { auctionRoomId: roomId });

    let [room] = (await t.withIdentity(SUPER).query(api.ops.liveOverview, {})).rooms;
    expect(room.online.map((p) => [p.email, p.role]).sort()).toEqual([
      [ORG.email, "console"],
      [OWNER.email, "owner"],
    ]);

    vi.advanceTimersByTime(80_000);
    [room] = (await t.withIdentity(SUPER).query(api.ops.liveOverview, {})).rooms;
    expect(room.online).toEqual([]);
  });
});

describe("client error reports", () => {
  test("staff and owners can report; strangers are ignored; messages are capped", async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await setup(t);
    await t.withIdentity(ORG).mutation(api.ops.reportClientError, {
      auctionRoomId: roomId,
      fn: "auctions:placeBid",
      message: "x".repeat(1_000),
    });
    await t.withIdentity(STRANGER).mutation(api.ops.reportClientError, { auctionRoomId: roomId, fn: "f", message: "spam" });

    const { recentErrors } = await t.withIdentity(SUPER).query(api.ops.liveOverview, {});
    expect(recentErrors).toHaveLength(1);
    expect(recentErrors[0]).toMatchObject({ fn: "auctions:placeBid", email: ORG.email });
    expect(recentErrors[0].message.length).toBeLessThanOrEqual(300);
  });

  test("reports are rate-limited per user", async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await setup(t);
    for (let i = 0; i < 40; i++) {
      await t.withIdentity(ORG).mutation(api.ops.reportClientError, { auctionRoomId: roomId, fn: "f", message: `e${i}` });
    }
    const errors = await t.run((ctx) => ctx.db.query("clientErrors").collect());
    expect(errors).toHaveLength(30);
  });
});

describe("webhook log", () => {
  test("every webhook is recorded, including bad signatures", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    await t.fetch("/razorpay/webhook", {
      method: "POST",
      headers: { "X-Razorpay-Signature": "bad" },
      body: JSON.stringify({ event: "order.paid" }),
    });

    const { webhooks } = await t.withIdentity(SUPER).query(api.ops.liveOverview, {});
    expect(webhooks[0]).toMatchObject({ outcome: "invalid signature" });
  });
});

describe("liveOverview", () => {
  test("is super-admin only", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    await expect(t.withIdentity(ORG).query(api.ops.liveOverview, {})).rejects.toThrow(/Admin access required/);
  });

  test("lists live rooms, the WhatsApp queue and refunds due", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.run(async (ctx) => {
      const userId = (await ctx.db.query("users").first())!._id;
      await ctx.db.insert("paymentOrders", {
        tournamentId,
        tier: "club",
        amount: 99_900,
        razorpayOrderId: "o1",
        status: "paid",
        refundDue: true,
        createdBy: userId,
        createdAt: Date.now(),
      });
    });

    const overview = await t.withIdentity(SUPER).query(api.ops.liveOverview, {});
    expect(overview.rooms).toHaveLength(1);
    expect(overview.rooms[0]).toMatchObject({ tournamentName: "Ops Cup", status: "live" });
    expect(overview.whatsapp).toMatchObject({ queued: 0, failed: 0 });
    expect(overview.refundsDue).toMatchObject({ plans: 1, registrations: 0 });
  });
});
