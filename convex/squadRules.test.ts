/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { syncTournamentAuctionCounts } from "./auctionCounts";
import { maxAllowedBid } from "./bidRules";
import {
  maxRuleViolation,
  minRuleSlots,
  normaliseRoles,
  ruleMatches,
  ruleStatus,
} from "./squadRules";

const categories = [
  { id: "marquee", name: "Marquee", basePrice: 500_000, order: 0, colour: "#f59e0b" },
];
const maxMarquee = { id: "r1", categoryId: "marquee", max: 2 };
const minWk = { id: "r2", role: "Wicket Keeper", min: 1 };

const batter = { role: ["Batter"] };
const marquee = { role: ["Batter"], categoryId: "marquee" };
const keeper = { role: ["Wicket Keeper"] };

describe("normaliseRoles / ruleMatches", () => {
  test("legacy role spellings match the canonical role", () => {
    expect(normaliseRoles("All Rounder")).toEqual(["All-Rounder"]);
    expect(normaliseRoles(["Batter", "Wicket-Keeper"])).toEqual(["Batter", "Wicket Keeper"]);
    expect(ruleMatches(minWk, { role: "Wicket-Keeper" })).toBe(true);
  });

  test("category rules match on categoryId only", () => {
    expect(ruleMatches(maxMarquee, marquee)).toBe(true);
    expect(ruleMatches(maxMarquee, batter)).toBe(false);
  });
});

describe("maxRuleViolation", () => {
  test("rejects a player who would exceed a max", () => {
    expect(maxRuleViolation([maxMarquee], categories, [marquee, marquee], marquee)).toBe(
      "Team already has 2 Marquee (max 2)",
    );
  });

  test("fine under the max, or when the player doesn't match", () => {
    expect(maxRuleViolation([maxMarquee], categories, [marquee], marquee)).toBeNull();
    expect(maxRuleViolation([maxMarquee], categories, [marquee, marquee], batter)).toBeNull();
  });
});

describe("minRuleSlots", () => {
  test("an unfilled minimum reserves one slot at the cheapest eligible price", () => {
    expect(minRuleSlots([minWk], [], batter, [{ ruleId: "r2", price: 300_000 }])).toEqual([
      { ruleId: "r2", unfilled: 1, price: 300_000 },
    ]);
  });

  test("the player being bought counts toward the minimum", () => {
    expect(minRuleSlots([minWk], [], keeper, [])).toEqual([]);
  });

  test("a met minimum needs no slots", () => {
    expect(minRuleSlots([minWk], [keeper], batter, [])).toEqual([]);
  });

  test("no eligible pending player: the price is left to the general reserve", () => {
    expect(minRuleSlots([minWk], [], batter, [])).toEqual([
      { ruleId: "r2", unfilled: 1, price: undefined },
    ]);
  });
});

describe("maxAllowedBid with min-rule slots", () => {
  const base = { purseRemaining: 1_000_000, playersOnTeam: 0, maxPlayersPerTeam: 3, reservePrice: 100_000 };

  test("no rules: unchanged (2 future slots x 1L)", () => {
    expect(maxAllowedBid(base)).toBe(800_000);
    expect(maxAllowedBid({ ...base, minRuleSlots: [] })).toBe(800_000);
  });

  test("a 5L minimum slot raises the reserve: 5L + 1L", () => {
    expect(maxAllowedBid({ ...base, minRuleSlots: [{ unfilled: 1, price: 500_000 }] })).toBe(400_000);
  });

  test("an eligible price below the general reserve never lowers it", () => {
    expect(maxAllowedBid({ ...base, minRuleSlots: [{ unfilled: 1, price: 50_000 }] })).toBe(800_000);
    expect(maxAllowedBid({ ...base, minRuleSlots: [{ unfilled: 1, price: undefined }] })).toBe(800_000);
  });

  test("more unfilled minimums than future slots: cannot bid at all", () => {
    expect(
      maxAllowedBid({ ...base, playersOnTeam: 2, minRuleSlots: [{ unfilled: 1, price: 100_000 }] }),
    ).toBe(0);
  });
});

describe("ruleStatus", () => {
  test("counts per rule with labels for the team card", () => {
    expect(ruleStatus([minWk, maxMarquee], categories, [marquee, keeper])).toEqual([
      { ruleId: "r2", label: "WK", count: 1, min: 1, max: undefined, ok: true },
      { ruleId: "r1", label: "Marquee", count: 1, min: undefined, max: 2, ok: true },
    ]);
    expect(ruleStatus([minWk], categories, [])[0]).toMatchObject({ count: 0, ok: false });
  });
});

describe("couples and squad rules", () => {
  const coupleWithBowler = { role: ["Batter"], partner: { role: ["Bowler"] } };
  const maxBowler = { id: "r3", role: "Bowler", max: 1 };

  test("a role rule matches on the partner's role too", () => {
    expect(ruleMatches(maxBowler, coupleWithBowler)).toBe(true);
    expect(ruleMatches({ id: "r4", role: "Batter", min: 1 }, coupleWithBowler)).toBe(true);
    expect(ruleMatches(minWk, coupleWithBowler)).toBe(false);
    expect(ruleMatches(maxBowler, { role: ["Batter"] })).toBe(false);
    // A legacy spelling on the partner still counts.
    expect(ruleMatches({ id: "r5", role: "All-Rounder", min: 1 }, { role: ["Batter"], partner: { role: ["All Rounder"] } })).toBe(true);
    expect(ruleStatus([{ id: "r6", role: "Bowler", min: 1 }], categories, [coupleWithBowler])[0]).toMatchObject({ count: 1, ok: true });
  });

  const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);
  const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };
  const BASE_PURSE = 1_000_000;

  async function setup(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const adminId = await ctx.db.insert("users", { email: ADMIN_IDENTITY.email, role: "admin", createdAt: now });
      const tournamentId = await ctx.db.insert("tournaments", {
        name: "Couple Cup",
        createdBy: adminId,
        status: "active",
        settings: {
          basePurse: BASE_PURSE,
          minBidIncrement: 25_000,
          maxPlayersPerTeam: 2,
          basePrice: 100_000,
          bidTimerSeconds: 0,
          format: "couple",
          squadRules: [maxBowler],
        },
        createdAt: now,
        updatedAt: now,
      });
      const teams: Id<"teams">[] = [];
      for (const name of ["A", "B"]) {
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
      const coupleId = await ctx.db.insert("players", {
        tournamentId,
        name: "Ravi & Priya",
        age: 25,
        role: ["Batter"],
        battingBowlingHand: "Right-handed",
        partner: { phoneNumber: "9123456780", role: ["Bowler"], battingBowlingHand: "Left-handed" },
        auctionStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });
      const roomId = await ctx.db.insert("auctionRooms", {
        tournamentId,
        name: "Room",
        status: "live",
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      });
      await syncTournamentAuctionCounts(ctx, tournamentId);
      return { tournamentId, teams, roomId, coupleId };
    });
  }

  async function expectMoneyInvariants(t: ReturnType<typeof convexTest>, teamIds: Id<"teams">[]) {
    await t.run(async (ctx) => {
      for (const teamId of teamIds) {
        const team = (await ctx.db.get(teamId))!;
        const players = (await ctx.db.query("players").collect()).filter((p) => p.teamId === teamId);
        const sold = players.filter((p) => p.auctionStatus === "sold");
        expect(team.purseRemaining + team.purseSpent).toBe(BASE_PURSE + (team.purseAdjustment ?? 0));
        expect(team.purseSpent).toBe(sold.reduce((sum, p) => sum + (p.soldPrice ?? 0), 0));
      }
    });
  }

  test("a sold couple uses one squad slot, its partner counts for role rules, and the purse invariants hold through a revert", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { tournamentId, teams, roomId, coupleId } = await setup(t);

    await asAdmin.mutation(api.auctions.startNextPlayer, { auctionRoomId: roomId });
    expect(await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teams[0], amount: 100_000 })).toMatchObject({
      success: true,
    });
    await asAdmin.mutation(api.auctions.finalizePlayerSale, { auctionRoomId: roomId });
    expect(await t.run((ctx) => ctx.db.get(coupleId))).toMatchObject({ auctionStatus: "sold", teamId: teams[0], soldPrice: 100_000 });
    await expectMoneyInvariants(t, teams);

    // A solo bowler next: Team A's couple already has a female bowler (max 1).
    const soloId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("players", {
        tournamentId,
        name: "Meera",
        age: 24,
        role: ["Bowler"],
        battingBowlingHand: "Right-handed",
        gender: "female",
        auctionStatus: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await syncTournamentAuctionCounts(ctx, tournamentId);
      return id;
    });
    await asAdmin.mutation(api.auctions.startNextPlayer, { auctionRoomId: roomId });

    const roster = (await t.query(api.auctions.getAuctionRoster, { tournamentId, currentPlayerId: soloId }))!;
    const teamA = roster.teams.find((team) => team._id === teams[0])!;
    expect(teamA).toMatchObject({ playerCount: 1, playersNeeded: 1, isSquadFull: false });

    const refused = await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teams[0], amount: 100_000 });
    expect(refused).toMatchObject({ success: false });
    expect((refused as { reason: string }).reason).toMatch(/max 1/);
    expect(await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teams[1], amount: 100_000 })).toMatchObject({
      success: true,
    });

    // Revert the couple's sale: the money comes back and the invariants still hold.
    await asAdmin.mutation(api.admin.updatePlayerStatus, { playerId: coupleId, newStatus: "pending" });
    expect(await t.run((ctx) => ctx.db.get(teams[0]))).toMatchObject({ purseSpent: 0, purseRemaining: BASE_PURSE });
    await expectMoneyInvariants(t, teams);
  });
});
