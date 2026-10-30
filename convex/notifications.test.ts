/// <reference types="vite/client" />
// WhatsApp outbox (AUDIT 2026-10 P1-14): one message per player and team,
// consent respected, retried with a cap, and a sale never depends on it.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };

/** Live room with a player on the block and one bid from Team A. */
async function setup(t: ReturnType<typeof convexTest>, player: { phoneNumber?: string; consentWhatsApp?: boolean } = {}) {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", { email: ADMIN_IDENTITY.email, role: "admin", createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Msg Cup",
      createdBy: adminId,
      status: "active",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5, basePrice: 100_000, bidTimerSeconds: 0 },
      createdAt: now,
      updatedAt: now,
    });
    const teamId = await ctx.db.insert("teams", {
      tournamentId,
      name: "Team A",
      ownerName: "Owner",
      purseRemaining: 1_000_000,
      purseSpent: 0,
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      createdAt: now,
      updatedAt: now,
    });
    const playerId = await ctx.db.insert("players", {
      tournamentId,
      name: "Ravi",
      age: 25,
      role: "Batter",
      battingBowlingHand: "Right-handed",
      auctionStatus: "in_auction",
      phoneNumber: "9876543210",
      ...player,
      createdAt: now,
      updatedAt: now,
    });
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room",
      status: "live",
      currentPlayerId: playerId,
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    return { tournamentId, teamId, playerId, roomId };
  });
  await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.placeBid, {
    auctionRoomId: ids.roomId,
    teamId: ids.teamId,
    amount: 100_000,
  });
  return ids;
}

async function sell(t: ReturnType<typeof convexTest>, roomId: Id<"auctionRooms">) {
  return await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.finalizePlayerSale, { auctionRoomId: roomId });
}

const outbox = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("notifications").collect());

beforeEach(() => {
  vi.useFakeTimers();
  process.env.WHATSAPP_PHONE_NUMBER_ID = "pn";
  process.env.WHATSAPP_ACCESS_TOKEN = "tok";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
});

describe("WhatsApp outbox", () => {
  test("a sale queues one message, and the worker sends it", async () => {
    const fetchMock = vi.fn(async () => Response.json({ messages: [{ id: "wamid.1" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const { roomId } = await setup(t);

    await sell(t, roomId);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const rows = await outbox(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("selling the same player to the same team again (e.g. after a restart) does not message twice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ messages: [{ id: "wamid.1" }] })));
    const t = convexTest(schema, modules);
    const { roomId, playerId, teamId } = await setup(t);
    await sell(t, roomId);
    await t.run(async (ctx) => {
      await ctx.db.patch(playerId, { auctionStatus: "in_auction", teamId: undefined, soldPrice: undefined });
      await ctx.db.patch(roomId, { currentPlayerId: playerId });
      await ctx.db.patch(teamId, { purseRemaining: 1_000_000, purseSpent: 0 });
    });
    await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId, amount: 150_000 });

    await sell(t, roomId);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await outbox(t)).toHaveLength(1);
  });

  test("a player who declined WhatsApp on the registration form is not messaged", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const t = convexTest(schema, modules);
    const { roomId } = await setup(t, { consentWhatsApp: false });

    await sell(t, roomId);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await outbox(t)).toEqual([]);
  });

  test("failures retry with a cap, then stop; the sale stands throughout", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const { roomId, playerId } = await setup(t);

    const sale = await sell(t, roomId);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(sale).toMatchObject({ success: true, sold: true });
    const [row] = await outbox(t);
    expect(row).toMatchObject({ status: "failed", attempts: 5 });
    expect(row.lastError).toContain("500");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect((await t.run((ctx) => ctx.db.get(playerId)))?.auctionStatus).toBe("sold");
  });

  test("registration approval carries the WhatsApp consent onto the player", async () => {
    const t = convexTest(schema, modules);
    const owner = { email: "owner@test.com", subject: "owner|1" };
    const tournamentId = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { email: owner.email, createdAt: Date.now() });
      const id = await ctx.db.insert("tournaments", {
        name: "Reg Cup",
        createdBy: ownerId,
        status: "setup",
        settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5, registrationOpen: true },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("tournamentStaff", { tournamentId: id, userId: ownerId, role: "owner", createdAt: Date.now() });
      return id;
    });
    const res = await t.mutation(api.registrations.submit, {
      tournamentId,
      name: "Declined",
      age: 22,
      role: ["Bowler"],
      battingBowlingHand: "Right-handed",
      phoneNumber: "9876543210",
      consentWhatsApp: false,
      website: "",
    });

    const playerId = await t
      .withIdentity(owner)
      .mutation(api.registrations.approve, { registrationId: res.registrationId as Id<"registrations"> });

    expect((await t.run((ctx) => ctx.db.get(playerId)))?.consentWhatsApp).toBe(false);
  });

  test("super-admins can see the queue depth; nobody else can", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const t = convexTest(schema, modules);
    const { roomId } = await setup(t);
    await sell(t, roomId);

    expect(await t.withIdentity(ADMIN_IDENTITY).query(api.notifications.queueStats, {})).toMatchObject({ queued: 1 });
    await t.run((ctx) => ctx.db.insert("users", { email: "x@test.com", role: "user", createdAt: Date.now() }));
    await expect(t.withIdentity({ email: "x@test.com", subject: "x" }).query(api.notifications.queueStats, {})).rejects.toThrow(
      /Admin access required/,
    );
  });
});
