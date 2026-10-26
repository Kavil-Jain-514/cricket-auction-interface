/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Discover the Convex function modules for the test runtime (see
// auctions.test.ts for why _generated must stay included).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };

/** Seed an admin user, a tournament and one existing player. */
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
      status: "setup",
      settings: {
        basePurse: 1_000_000,
        minBidIncrement: 25_000,
        bidTimerSeconds: 30,
        maxPlayersPerTeam: 5,
        basePrice: 100_000,
      },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("players", {
      tournamentId,
      name: "Rohit Sharma",
      phoneNumber: "9876543210",
      age: 36,
      role: ["Batter"],
      battingBowlingHand: "Right-handed",
      auctionStatus: "pending",
      playerNumber: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { adminId, tournamentId };
  });
}

const row = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  age: 25,
  role: ["Batter"],
  battingBowlingHand: "Right-handed" as const,
  ...extra,
});

async function countPlayers(t: ReturnType<typeof convexTest>) {
  return (await t.run((ctx) => ctx.db.query("players").collect())).length;
}

describe("players.bulkImport — validation", () => {
  test("a bad row rejects the whole batch without inserting anything", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t);

    const res = await asAdmin.mutation(api.players.bulkImport, {
      tournamentId,
      players: [
        row("Good Player"),
        row("Bad Jersey", { jerseyNumber: 150 }),
        row("Bad Phone", { phoneNumber: "12345" }),
      ],
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("unreachable");
    expect(res.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 1, field: "jerseyNumber" }),
        expect.objectContaining({ row: 2, field: "phoneNumber" }),
      ]),
    );
    expect(await countPlayers(t)).toBe(1);
  });

  test("flags a duplicate of an existing player (same name + phone)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t);

    const res = await asAdmin.mutation(api.players.bulkImport, {
      tournamentId,
      players: [
        row("New Player"),
        row("rohit sharma", { phoneNumber: "+91 98765-43210" }),
      ],
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("unreachable");
    expect(res.errors).toEqual([
      expect.objectContaining({ row: 1, field: "name" }),
    ]);
    expect(await countPlayers(t)).toBe(1);
  });

  test("flags duplicates within the same batch", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t);

    const res = await asAdmin.mutation(api.players.bulkImport, {
      tournamentId,
      players: [
        row("Twin", { phoneNumber: "9000000001" }),
        row("Twin", { phoneNumber: "09000000001" }),
      ],
    });

    expect(res.success).toBe(false);
    expect(await countPlayers(t)).toBe(1);
  });

  test("a valid batch inserts every row with normalised phones", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t);

    const res = await asAdmin.mutation(api.players.bulkImport, {
      tournamentId,
      players: [
        row("Alpha", { phoneNumber: "+91 91234-56780" }),
        row("Beta", { age: 0 }),
      ],
    });

    expect(res).toMatchObject({ success: true, count: 2 });
    const players = await t.run((ctx) => ctx.db.query("players").collect());
    expect(players.find((p) => p.name === "Alpha")?.phoneNumber).toBe(
      "9123456780",
    );
  });
});

describe("players.create / update — validation", () => {
  test("create rejects an out-of-range age", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t);

    await expect(
      asAdmin.mutation(api.players.create, {
        tournamentId,
        ...row("Kid", { age: 3 }),
      }),
    ).rejects.toThrow(/age/i);
  });

  test("update rejects a bad phone and a bad jersey", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t);
    const playerId = await asAdmin.mutation(api.players.create, {
      tournamentId,
      ...row("Editable"),
    });

    await expect(
      asAdmin.mutation(api.players.update, { id: playerId, phoneNumber: "1" }),
    ).rejects.toThrow(/phone/i);
    await expect(
      asAdmin.mutation(api.players.update, { id: playerId, jerseyNumber: 0 }),
    ).rejects.toThrow(/jersey/i);
  });
});
