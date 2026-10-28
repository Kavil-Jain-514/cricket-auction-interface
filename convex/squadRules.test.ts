import { describe, expect, test } from "vitest";
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
