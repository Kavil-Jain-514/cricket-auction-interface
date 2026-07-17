/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

// Discover the Convex function modules for the test runtime (see
// auctions.test.ts for why _generated must stay included).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };
const USER_IDENTITY = { email: "user@test.com", subject: "user|1" };

/** Seed an admin user, a regular user, and a tournament with N teams. */
async function setup(t: ReturnType<typeof convexTest>, teamCount: number) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", {
      email: ADMIN_IDENTITY.email,
      role: "admin",
      createdAt: now,
    });
    await ctx.db.insert("users", {
      email: USER_IDENTITY.email,
      role: "user",
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
    const teamIds: Id<"teams">[] = [];
    for (let i = 0; i < teamCount; i++) {
      teamIds.push(
        await ctx.db.insert("teams", {
          tournamentId,
          name: `Team ${i + 1}`,
          ownerName: "owner",
          purseRemaining: 1_000_000,
          purseSpent: 0,
          colorPrimary: "#111111",
          colorSecondary: "#222222",
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    return { tournamentId, teamIds };
  });
}

describe("groupDraws.runDraw", () => {
  test("persists a draw with every team assigned exactly once", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, teamIds } = await setup(t, 10);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    await asAdmin.mutation(api.groupDraws.runDraw, {
      tournamentId,
      numGroups: 3,
    });

    const draw = await asAdmin.query(api.groupDraws.getByTournament, {
      tournamentId,
    });
    expect(draw).not.toBeNull();
    expect(draw!.status).toBe("drawn");
    expect(draw!.numGroups).toBe(3);
    expect(draw!.assignments).toHaveLength(10);

    // Every team appears exactly once
    const assignedIds = draw!.assignments.map((a) => a.teamId);
    expect(new Set(assignedIds).size).toBe(10);
    expect([...assignedIds].sort()).toEqual([...teamIds].sort());

    // Uneven 10/3 split → 4/3/3 with sequential labels
    const groupA = draw!.assignments.filter((a) => a.group === "A");
    expect(groupA).toHaveLength(4);
    expect(groupA.map((a) => a.slotLabel)).toEqual(["A1", "A2", "A3", "A4"]);
    expect(draw!.assignments.filter((a) => a.group === "B")).toHaveLength(3);
    expect(draw!.assignments.filter((a) => a.group === "C")).toHaveLength(3);
  });

  test("rejects invalid group counts", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, 4);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    await expect(
      asAdmin.mutation(api.groupDraws.runDraw, { tournamentId, numGroups: 5 }),
    ).rejects.toThrow(/cannot exceed/);
    await expect(
      asAdmin.mutation(api.groupDraws.runDraw, { tournamentId, numGroups: 0 }),
    ).rejects.toThrow(/at least 1 group/);
  });

  test("re-running replaces the previous draw in place", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, 8);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    const firstId = await asAdmin.mutation(api.groupDraws.runDraw, {
      tournamentId,
      numGroups: 2,
    });
    const secondId = await asAdmin.mutation(api.groupDraws.runDraw, {
      tournamentId,
      numGroups: 4,
    });

    expect(secondId).toBe(firstId);
    const draw = await asAdmin.query(api.groupDraws.getByTournament, {
      tournamentId,
    });
    expect(draw!.numGroups).toBe(4);
    expect(draw!.assignments).toHaveLength(8);
    expect(draw!.assignments.filter((a) => a.group === "D")).toHaveLength(2);
  });

  test("locked draws cannot be re-shuffled", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, 6);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    await asAdmin.mutation(api.groupDraws.runDraw, {
      tournamentId,
      numGroups: 2,
    });
    await asAdmin.mutation(api.groupDraws.lockDraw, { tournamentId });

    await expect(
      asAdmin.mutation(api.groupDraws.runDraw, { tournamentId, numGroups: 2 }),
    ).rejects.toThrow(/locked/);

    const draw = await asAdmin.query(api.groupDraws.getByTournament, {
      tournamentId,
    });
    expect(draw!.status).toBe("locked");
  });

  test("requires admin role", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, 4);
    const asUser = t.withIdentity(USER_IDENTITY);

    await expect(
      asUser.mutation(api.groupDraws.runDraw, { tournamentId, numGroups: 2 }),
    ).rejects.toThrow(/Admin access required/);
  });
});

describe("groupDraws.resetDraw", () => {
  test("deletes the draw, even when locked", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, 4);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    await asAdmin.mutation(api.groupDraws.runDraw, {
      tournamentId,
      numGroups: 2,
    });
    await asAdmin.mutation(api.groupDraws.lockDraw, { tournamentId });
    await asAdmin.mutation(api.groupDraws.resetDraw, { tournamentId });

    const draw = await asAdmin.query(api.groupDraws.getByTournament, {
      tournamentId,
    });
    expect(draw).toBeNull();

    // After reset, a fresh draw can be run again
    await asAdmin.mutation(api.groupDraws.runDraw, {
      tournamentId,
      numGroups: 2,
    });
    const fresh = await asAdmin.query(api.groupDraws.getByTournament, {
      tournamentId,
    });
    expect(fresh!.status).toBe("drawn");
  });
});
