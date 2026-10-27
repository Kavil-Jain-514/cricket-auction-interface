import { describe, expect, test } from "vitest";
import { bestValueBuy, budgetPace, fairValueBand, needsSummary, roleBalance } from "./insights";

const wk = { role: ["Wicket Keeper"] };
const bat = { role: ["Batter"] };
const bowl = { role: "Bowler" };

describe("roleBalance", () => {
  test("counts every role and flags gaps against role minimums", () => {
    const rows = roleBalance([bat, bat, bowl], [
      { id: "r1", role: "Wicket Keeper", min: 1 },
      { id: "r2", role: "Bowler", min: 3, max: 5 },
      { id: "r3", categoryId: "marquee", max: 2 },
    ]);
    expect(rows).toEqual([
      { role: "Batter", count: 2, min: undefined, max: undefined, gap: 0 },
      { role: "Bowler", count: 1, min: 3, max: 5, gap: 2 },
      { role: "All-Rounder", count: 0, min: undefined, max: undefined, gap: 0 },
      { role: "Wicket Keeper", count: 0, min: 1, max: undefined, gap: 1 },
    ]);
  });

  test("legacy role spellings count", () => {
    expect(roleBalance([{ role: "Wicket-Keeper" }], [])[3]).toMatchObject({ role: "Wicket Keeper", count: 1 });
  });
});

describe("needsSummary", () => {
  test("names each unmet minimum, roles and categories alike", () => {
    expect(
      needsSummary([
        { label: "WK", count: 0, min: 1 },
        { label: "Bowler", count: 1, min: 3 },
        { label: "Marquee", count: 2, min: 1 },
        { label: "AR", count: 0 },
      ]),
    ).toBe("You need 1 WK, 2 Bowler");
    expect(needsSummary([{ label: "WK", count: 1, min: 1 }])).toBeNull();
  });
});

describe("budgetPace", () => {
  test("rupees per remaining slot, coloured against the tournament average", () => {
    expect(budgetPace({ purse: 400_000, slotsLeft: 4, cheapestBase: 50_000, tournamentAvgPerSlot: 100_000 })).toEqual({ perSlot: 100_000, tone: "good" });
    expect(budgetPace({ purse: 320_000, slotsLeft: 4, cheapestBase: 50_000, tournamentAvgPerSlot: 100_000 }).tone).toBe("warning");
    expect(budgetPace({ purse: 200_000, slotsLeft: 4, cheapestBase: 50_000, tournamentAvgPerSlot: 100_000 }).tone).toBe("critical");
  });

  test("critical when the purse can't cover the cheapest player per slot", () => {
    expect(budgetPace({ purse: 150_000, slotsLeft: 4, cheapestBase: 50_000, tournamentAvgPerSlot: 30_000 }).tone).toBe("critical");
  });

  test("no slots left: no pace", () => {
    expect(budgetPace({ purse: 100_000, slotsLeft: 0, cheapestBase: 50_000, tournamentAvgPerSlot: 0 })).toEqual({ perSlot: null, tone: "good" });
  });
});

describe("fairValueBand", () => {
  const sold = (price: number, categoryId?: string, role: string[] = ["Batter"]) => ({ soldPrice: price, categoryId, role });

  test("null until three comparable sales", () => {
    expect(fairValueBand({ role: ["Batter"] }, [sold(100), sold(200)])).toBeNull();
  });

  test("median and IQR of the same category sharing a role", () => {
    const history = [sold(100_000), sold(200_000), sold(300_000), sold(400_000), sold(900_000, "marquee"), sold(50_000, undefined, ["Bowler"])];
    expect(fairValueBand({ role: ["Batter", "Wicket Keeper"] }, history)).toEqual({ median: 250_000, low: 175_000, high: 325_000, count: 4 });
  });
});

describe("bestValueBuy", () => {
  test("lowest price-to-base ratio", () => {
    const squad = [
      { name: "Steal", soldPrice: 120_000, basePrice: 100_000 },
      { name: "Pricey", soldPrice: 500_000, basePrice: 100_000 },
      { name: "At base", soldPrice: 200_000, basePrice: 200_000 },
    ];
    expect(bestValueBuy(squad)?.name).toBe("At base");
    expect(bestValueBuy([])).toBeNull();
  });
});

describe("ownerInsights", () => {
  test("combines needs, pace and the current player's band for one team", async () => {
    const { ownerInsights } = await import("./insights");
    const roster = {
      teams: [
        { _id: "a", purseRemaining: 400_000, playersNeeded: 4, ruleStatus: [{ label: "WK", count: 0, min: 1 }] },
        { _id: "b", purseRemaining: 800_000, playersNeeded: 4 },
      ],
      soldPlayers: [100_000, 200_000, 300_000].map((soldPrice) => ({ soldPrice, role: ["Batter"] })),
      currentPlayer: { role: ["Batter"] },
      minBasePrice: 50_000,
    };
    expect(ownerInsights(roster, "a")).toEqual({
      needs: "You need 1 WK",
      pace: { perSlot: 100_000, tone: "warning" },
      fairValue: { median: 200_000, low: 150_000, high: 250_000, count: 3 },
    });
    expect(ownerInsights(roster, "zzz")).toBeNull();
  });
});
