/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc } from "./_generated/dataModel";

// Discover the Convex function modules for the test runtime (see
// auctions.test.ts for why _generated must stay included).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };

const SETTINGS = {
  basePurse: 1_000_000,
  minBidIncrement: 25_000,
  bidTimerSeconds: 30,
  maxPlayersPerTeam: 5,
  basePrice: 100_000,
};

/** Seed an admin user + tournament with one auction room in the given status. */
async function setup(
  t: ReturnType<typeof convexTest>,
  opts: { roomStatus?: Doc<"auctionRooms">["status"] } = {},
) {
  const { roomStatus = "waiting" } = opts;
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
      settings: SETTINGS,
      createdAt: now,
      updatedAt: now,
    });
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room 1",
      status: roomStatus,
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    return { adminId, tournamentId, roomId };
  });
}

describe("tournaments.update — validation", () => {
  test("rejects NaN, zero and negative settings", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t);

    for (const key of [
      "basePurse",
      "minBidIncrement",
      "maxPlayersPerTeam",
      "basePrice",
    ] as const) {
      for (const bad of [NaN, 0, -100]) {
        await expect(
          asAdmin.mutation(api.tournaments.update, {
            id: tournamentId,
            settings: { ...SETTINGS, [key]: bad },
          }),
        ).rejects.toThrow();
      }
    }

    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.settings).toEqual(SETTINGS);
  });

  test("rejects a bad name", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t);

    await expect(
      asAdmin.mutation(api.tournaments.update, { id: tournamentId, name: "x" }),
    ).rejects.toThrow(/at least 3/);
  });

  test("a name-only edit succeeds while a room is live", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { roomStatus: "live" });

    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      name: "Renamed Cup",
      description: "Now with a description",
    });

    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.name).toBe("Renamed Cup");
  });

  test("resending unchanged settings succeeds while a room is live", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { roomStatus: "live" });

    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      name: "Renamed Cup",
      settings: { ...SETTINGS, bidTimerSeconds: undefined },
    });

    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.name).toBe("Renamed Cup");
    expect(tournament?.settings).toEqual(SETTINGS);
  });

  test("changing a money setting while a room is live is rejected", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { roomStatus: "paused" });

    await expect(
      asAdmin.mutation(api.tournaments.update, {
        id: tournamentId,
        settings: { ...SETTINGS, basePurse: 2_000_000 },
      }),
    ).rejects.toThrow(/locked/i);
  });
});

describe("tournaments.create — validation", () => {
  test("rejects NaN settings", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await setup(t);

    await expect(
      asAdmin.mutation(api.tournaments.create, {
        name: "New Cup",
        settings: { ...SETTINGS, maxPlayersPerTeam: NaN },
      }),
    ).rejects.toThrow(/players/i);
  });
});

describe("tournaments.update — footer text", () => {
  test("setting only footerText succeeds while a room is live", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { roomStatus: "live" });

    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...SETTINGS, footerText: "  Hosted by the Club  " },
    });

    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.settings.footerText).toBe("Hosted by the Club");
    expect(tournament?.settings.basePurse).toBe(SETTINGS.basePurse);
  });

  test("clearing footerText removes it", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { roomStatus: "live" });
    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...SETTINGS, footerText: "Hosted by the Club" },
    });

    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...SETTINGS, footerText: "" },
    });

    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.settings.footerText).toBeUndefined();
  });

  test("rejects footer text over 120 characters", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t);

    await expect(
      asAdmin.mutation(api.tournaments.update, {
        id: tournamentId,
        settings: { ...SETTINGS, footerText: "x".repeat(121) },
      }),
    ).rejects.toThrow(/120/);
  });
});

describe("tournaments.update — bid mode", () => {
  test("legacy tournaments have no bidMode (admin-only bidding)", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.settings.bidMode).toBeUndefined();
  });

  test("bidMode can change while a room is live", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { roomStatus: "live" });

    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...SETTINGS, bidMode: "confirm" },
    });
    let tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.settings.bidMode).toBe("confirm");
    expect(tournament?.settings.basePurse).toBe(SETTINGS.basePurse);

    // Omitting bidMode keeps the stored one.
    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...SETTINGS, footerText: "Hosted by the Club" },
    });
    tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.settings.bidMode).toBe("confirm");

    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...SETTINGS, bidMode: "admin_only" },
    });
    tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.settings.bidMode).toBe("admin_only");
  });

  test("a full settings change keeps the stored bidMode", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t);
    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...SETTINGS, bidMode: "open" },
    });

    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...SETTINGS, minBidIncrement: 50_000 },
    });
    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.settings.minBidIncrement).toBe(50_000);
    expect(tournament?.settings.bidMode).toBe("open");
  });
});

describe("tournaments.update — bid timer setting (X5)", () => {
  test("accepts 0 (off) and 10–120 while not live; keeps it when omitted", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t);
    const stored = async () =>
      (await t.run((ctx) => ctx.db.get(tournamentId)))?.settings.bidTimerSeconds;

    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...SETTINGS, bidTimerSeconds: 0 },
    });
    expect(await stored()).toBe(0);

    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...SETTINGS, bidTimerSeconds: 45 },
    });
    expect(await stored()).toBe(45);

    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      settings: { ...SETTINGS, basePurse: 2_000_000, bidTimerSeconds: undefined },
    });
    expect(await stored()).toBe(45);
  });

  test("rejects out-of-range timer values", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t);

    for (const bad of [5, 121, NaN, 12.5, -1]) {
      await expect(
        asAdmin.mutation(api.tournaments.update, {
          id: tournamentId,
          settings: { ...SETTINGS, bidTimerSeconds: bad },
        }),
      ).rejects.toThrow();
    }
    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.settings.bidTimerSeconds).toBe(30);
  });

  test("changing the timer while the auction is live is rejected", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId } = await setup(t, { roomStatus: "live" });

    await expect(
      asAdmin.mutation(api.tournaments.update, {
        id: tournamentId,
        settings: { ...SETTINGS, bidTimerSeconds: 0 },
      }),
    ).rejects.toThrow(/locked/);
  });
});
