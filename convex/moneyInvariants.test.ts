/// <reference types="vite/client" />
// Money (AUDIT 2026-10 P1-2, P1-3, P1-4): every amount is a whole number of
// rupees, no correction can credit a team through a bad price, and the purse
// invariants hold across any sequence of money-moving actions.
//   purseRemaining + purseSpent == basePurse + purseAdjustment
//   purseSpent == sum(soldPrice of the team's sold players)
import { convexTest } from "convex-test";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { maxAllowedBid } from "./bidRules";
import { syncTournamentAuctionCounts } from "./auctionCounts";
import { validateCategories, validateIncrementSlabs, validateSettings } from "./validation";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };
const BASE_PURSE = 1_000_000;
const SQUAD = 4;

/** Admin, tournament, three teams, a live room and `players` pending players. */
async function setup(t: ReturnType<typeof convexTest>, players = 6) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", { email: ADMIN_IDENTITY.email, role: "admin", createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Money Cup",
      createdBy: adminId,
      status: "active",
      settings: { basePurse: BASE_PURSE, minBidIncrement: 25_000, maxPlayersPerTeam: SQUAD, basePrice: 100_000, bidTimerSeconds: 0 },
      createdAt: now,
      updatedAt: now,
    });
    const teams: Id<"teams">[] = [];
    for (const name of ["A", "B", "C"]) {
      teams.push(
        await ctx.db.insert("teams", {
          tournamentId,
          name,
          ownerName: "owner",
          purseRemaining: BASE_PURSE,
          purseSpent: 0,
          colorPrimary: "#111111",
          colorSecondary: "#222222",
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    for (let i = 0; i < players; i++) {
      await ctx.db.insert("players", {
        tournamentId,
        name: `P${i}`,
        age: 25,
        role: "Batter",
        battingBowlingHand: "Right-handed",
        auctionStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room",
      status: "live",
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    await syncTournamentAuctionCounts(ctx, tournamentId);
    return { tournamentId, teams, roomId };
  });
}

async function soldPlayer(t: ReturnType<typeof convexTest>, tournamentId: Id<"tournaments">, teamId: Id<"teams">) {
  return await t.run(async (ctx) => {
    const playerId = await ctx.db.insert("players", {
      tournamentId,
      name: "Bought",
      age: 25,
      role: "Batter",
      battingBowlingHand: "Right-handed",
      auctionStatus: "sold",
      teamId,
      soldPrice: 200_000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const team = (await ctx.db.get(teamId))!;
    await ctx.db.patch(teamId, { purseRemaining: team.purseRemaining - 200_000, purseSpent: team.purseSpent + 200_000 });
    return playerId;
  });
}

describe("whole rupees only (P1-3)", () => {
  test("a fractional bid is refused", async () => {
    const t = convexTest(schema, modules);
    const { teams, roomId, tournamentId } = await setup(t);
    await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.startNextPlayer, { auctionRoomId: roomId });

    const res = await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teams[0],
      amount: 100_000.5,
    });

    expect(res).toEqual({ success: false, reason: "Bid must be a whole number of rupees" });
    expect(tournamentId).toBeDefined();
  });

  test("money settings must be whole rupees", () => {
    expect(validateSettings({ basePurse: 1_000_000.5, minBidIncrement: 25_000, maxPlayersPerTeam: 11 })).toMatch(/whole number/);
    expect(validateSettings({ basePurse: 1_000_000, minBidIncrement: 25_000.5, maxPlayersPerTeam: 11 })).toMatch(/whole number/);
    expect(validateSettings({ basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 11, basePrice: 1.5 })).toMatch(/whole number/);
    expect(
      validateCategories([{ id: "a", name: "A", basePrice: 100_000.5, order: 1, colour: "#111111" }], 1_000_000),
    ).toMatch(/whole number/);
    expect(validateIncrementSlabs([{ fromAmount: 0.5, increment: 25_000 }], 1_000_000)).toMatch(/whole number/);
  });
});

describe("admin corrections refuse bad prices (P1-2)", () => {
  const bad = [-100_000, 0, 150_000.5, Number.NaN, Number.POSITIVE_INFINITY];

  for (const price of bad) {
    test(`updateSoldPrice / reassignPlayer / updatePlayerStatus refuse ${price}`, async () => {
      const t = convexTest(schema, modules);
      const asAdmin = t.withIdentity(ADMIN_IDENTITY);
      const { tournamentId, teams } = await setup(t);
      const playerId = await soldPlayer(t, tournamentId, teams[0]);
      const before = await t.run((ctx) => ctx.db.get(teams[0]));

      await expect(asAdmin.mutation(api.admin.updateSoldPrice, { playerId, newSoldPrice: price })).rejects.toThrow(
        /whole number/,
      );
      await expect(
        asAdmin.mutation(api.admin.reassignPlayer, { playerId, newTeamId: teams[1], newSoldPrice: price }),
      ).rejects.toThrow(/whole number/);
      await expect(
        asAdmin.mutation(api.admin.updatePlayerStatus, { playerId, newStatus: "sold", teamId: teams[1], soldPrice: price }),
      ).rejects.toThrow(/whole number/);

      expect(await t.run((ctx) => ctx.db.get(teams[0]))).toMatchObject({
        purseRemaining: before!.purseRemaining,
        purseSpent: before!.purseSpent,
      });
    });
  }
});

describe("deleteAllByTournament keeps the purses right (P1-4)", () => {
  test("deleting sold players refunds their teams", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teams } = await setup(t);
    await soldPlayer(t, tournamentId, teams[0]);

    await asAdmin.mutation(api.players.deleteAllByTournament, { tournamentId, includesSold: true });

    expect(await t.run((ctx) => ctx.db.get(teams[0]))).toMatchObject({ purseRemaining: BASE_PURSE, purseSpent: 0 });
    const rec = await asAdmin.query(api.auctions.getReconciliation, { tournamentId });
    expect(rec.issues.filter((i) => i.kind !== "status_counts")).toEqual([]);
  });
});

// ── Property: the purse invariants survive any sequence of actions ─────────────

type Op =
  | { kind: "next" }
  | { kind: "bid"; team: number; steps: number }
  | { kind: "sell" }
  | { kind: "revert" }
  | { kind: "adjust"; team: number; amount: number }
  | { kind: "reprice"; price: number }
  | { kind: "unsell" }
  | { kind: "reassign"; team: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { arbitrary: fc.constant({ kind: "next" as const }), weight: 3 },
  {
    arbitrary: fc.record({ kind: fc.constant("bid" as const), team: fc.nat(2), steps: fc.integer({ min: 0, max: 8 }) }),
    weight: 6,
  },
  { arbitrary: fc.constant({ kind: "sell" as const }), weight: 3 },
  { arbitrary: fc.constant({ kind: "revert" as const }), weight: 1 },
  {
    arbitrary: fc.record({
      kind: fc.constant("adjust" as const),
      team: fc.nat(2),
      amount: fc.integer({ min: -200_000, max: 200_000 }).filter((n) => n !== 0),
    }),
    weight: 1,
  },
  // Includes bad prices: they must be refused without moving money.
  {
    arbitrary: fc.record({
      kind: fc.constant("reprice" as const),
      price: fc.oneof(fc.integer({ min: -100_000, max: 900_000 }), fc.constant(1.5), fc.constant(Number.NaN)),
    }),
    weight: 1,
  },
  { arbitrary: fc.constant({ kind: "unsell" as const }), weight: 1 },
  { arbitrary: fc.record({ kind: fc.constant("reassign" as const), team: fc.nat(2) }), weight: 1 },
);

describe("property: purse invariants", () => {
  test("hold after every step of a random auction, corrections included", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 5, maxLength: 30 }), async (ops) => {
        const t = convexTest(schema, modules);
        const asAdmin = t.withIdentity(ADMIN_IDENTITY);
        const { tournamentId, teams, roomId } = await setup(t);
        // Any refusal (thrown or { success: false }) is fine; only the books matter.
        const attempt = async (fn: () => Promise<unknown>) => {
          try {
            await fn();
          } catch {
            /* refused */
          }
        };

        for (const op of ops) {
          const live = await asAdmin.query(api.auctions.getLiveAuction, { auctionRoomId: roomId });
          const sold = await t.run(async (ctx) =>
            (await ctx.db.query("players").collect()).filter((p) => p.auctionStatus === "sold"),
          );
          const someSold = sold[0];
          switch (op.kind) {
            case "next":
              await attempt(() => asAdmin.mutation(api.auctions.startNextPlayer, { auctionRoomId: roomId }));
              break;
            case "bid":
              await attempt(() =>
                asAdmin.mutation(api.auctions.placeBid, {
                  auctionRoomId: roomId,
                  teamId: teams[op.team],
                  amount: (live?.currentBidAmount ?? 75_000) + 25_000 * (op.steps + 1),
                }),
              );
              break;
            case "sell":
              await attempt(() => asAdmin.mutation(api.auctions.finalizePlayerSale, { auctionRoomId: roomId }));
              break;
            case "revert":
              await attempt(() => asAdmin.mutation(api.auctions.revertLastBid, { auctionRoomId: roomId }));
              break;
            case "adjust":
              await attempt(() =>
                asAdmin.mutation(api.admin.adjustTeamPurse, { teamId: teams[op.team], amount: op.amount, reason: "test" }),
              );
              break;
            case "reprice":
              if (someSold) {
                await attempt(() =>
                  asAdmin.mutation(api.admin.updateSoldPrice, { playerId: someSold._id, newSoldPrice: op.price }),
                );
              }
              break;
            case "unsell":
              if (someSold) {
                await attempt(() =>
                  asAdmin.mutation(api.admin.updatePlayerStatus, { playerId: someSold._id, newStatus: "unsold" }),
                );
              }
              break;
            case "reassign":
              if (someSold) {
                await attempt(() =>
                  asAdmin.mutation(api.admin.reassignPlayer, { playerId: someSold._id, newTeamId: teams[op.team] }),
                );
              }
              break;
          }

          const rec = await asAdmin.query(api.auctions.getReconciliation, { tournamentId });
          expect(rec.issues).toEqual([]);
          const purses = await t.run(async (ctx) => Promise.all(teams.map((id) => ctx.db.get(id))));
          for (const team of purses) {
            expect(Number.isInteger(team!.purseRemaining)).toBe(true);
            expect(team!.purseRemaining).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      { numRuns: 25 },
    );
  }, 60_000);
});

// ── Property: the reserve rule never strands a team ──────────────────────────

describe("property: squad-completion reserve", () => {
  const state = fc
    .record({
      maxPlayersPerTeam: fc.integer({ min: 1, max: 25 }),
      playersOnTeam: fc.integer({ min: 0, max: 25 }),
      purseRemaining: fc.integer({ min: 0, max: 10_000_000 }),
      reservePrice: fc.integer({ min: 1, max: 500_000 }),
    })
    .filter((s) => s.playersOnTeam <= s.maxPlayersPerTeam);

  // A max of 0 means the team can't bid at all (squad full, or the purse
  // already can't cover the remaining slots), so there is nothing to strand.
  test("paying the max still leaves enough to fill every remaining slot at the reserve price", () => {
    fc.assert(
      fc.property(state, (s) => {
        const max = maxAllowedBid(s);
        const futureSlots = Math.max(0, s.maxPlayersPerTeam - s.playersOnTeam - 1);
        expect(max).toBeGreaterThanOrEqual(0);
        if (s.playersOnTeam >= s.maxPlayersPerTeam) expect(max).toBe(0);
        if (max === 0) return;
        expect(s.purseRemaining - max).toBeGreaterThanOrEqual(futureSlots * s.reservePrice);
      }),
    );
  });

  test("the max is tight: one rupee more would strand the team", () => {
    fc.assert(
      fc.property(state, (s) => {
        const max = maxAllowedBid(s);
        const futureSlots = Math.max(0, s.maxPlayersPerTeam - s.playersOnTeam - 1);
        if (max > 0) {
          expect(s.purseRemaining - (max + 1)).toBeLessThan(futureSlots * s.reservePrice);
        }
      }),
    );
  });

  test("a richer team can never bid less", () => {
    fc.assert(
      fc.property(state, fc.integer({ min: 0, max: 1_000_000 }), (s, extra) => {
        expect(maxAllowedBid({ ...s, purseRemaining: s.purseRemaining + extra })).toBeGreaterThanOrEqual(maxAllowedBid(s));
      }),
    );
  });

  test("buying at the max, then at reserve for every later slot, completes the squad without going negative", () => {
    fc.assert(
      fc.property(state, (s) => {
        const max = maxAllowedBid(s);
        if (max === 0) return;
        let purse = s.purseRemaining - max;
        let players = s.playersOnTeam + 1;
        while (players < s.maxPlayersPerTeam) {
          purse -= s.reservePrice;
          players++;
        }
        expect(purse).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
