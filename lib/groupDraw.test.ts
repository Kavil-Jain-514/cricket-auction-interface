import { describe, expect, test } from "vitest";
import {
  computeGroupAssignments,
  fisherYatesShuffle,
  getGroupSizes,
  groupName,
  validateGroupConfig,
  type Rng,
} from "./groupDraw";

/** Deterministic LCG so shuffle tests are reproducible. */
function seededRng(seed: number): Rng {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("groupName", () => {
  test("names groups alphabetically", () => {
    expect(groupName(0)).toBe("A");
    expect(groupName(1)).toBe("B");
    expect(groupName(25)).toBe("Z");
  });

  test("continues past Z with double letters", () => {
    expect(groupName(26)).toBe("AA");
    expect(groupName(27)).toBe("AB");
  });
});

describe("validateGroupConfig", () => {
  test("accepts valid configurations", () => {
    expect(validateGroupConfig(8, 4)).toBeNull();
    expect(validateGroupConfig(10, 3)).toBeNull();
    expect(validateGroupConfig(5, 1)).toBeNull();
    expect(validateGroupConfig(4, 4)).toBeNull();
  });

  test("rejects zero or negative groups", () => {
    expect(validateGroupConfig(8, 0)).toMatch(/at least 1 group/);
    expect(validateGroupConfig(8, -2)).toMatch(/at least 1 group/);
  });

  test("rejects more groups than teams", () => {
    expect(validateGroupConfig(3, 4)).toMatch(/cannot exceed/);
  });

  test("rejects non-integer group counts", () => {
    expect(validateGroupConfig(8, 2.5)).toMatch(/whole number/);
  });

  test("rejects a tournament with no teams", () => {
    expect(validateGroupConfig(0, 1)).toMatch(/Add teams/);
  });
});

describe("getGroupSizes", () => {
  test("even split", () => {
    expect(getGroupSizes(8, 4)).toEqual([2, 2, 2, 2]);
    expect(getGroupSizes(12, 3)).toEqual([4, 4, 4]);
  });

  test("uneven split gives extra teams to earlier groups", () => {
    expect(getGroupSizes(10, 3)).toEqual([4, 3, 3]);
    expect(getGroupSizes(7, 3)).toEqual([3, 2, 2]);
    expect(getGroupSizes(11, 4)).toEqual([3, 3, 3, 2]);
  });

  test("single group holds all teams", () => {
    expect(getGroupSizes(5, 1)).toEqual([5]);
  });

  test("groups == teams gives one team per group", () => {
    expect(getGroupSizes(4, 4)).toEqual([1, 1, 1, 1]);
  });
});

describe("fisherYatesShuffle", () => {
  test("does not mutate the input", () => {
    const input = [1, 2, 3, 4, 5];
    fisherYatesShuffle(input, seededRng(1));
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  test("preserves all elements", () => {
    const input = ["a", "b", "c", "d", "e", "f", "g"];
    const result = fisherYatesShuffle(input, seededRng(42));
    expect([...result].sort()).toEqual([...input].sort());
  });

  test("is deterministic for a given rng", () => {
    const input = [1, 2, 3, 4, 5, 6];
    expect(fisherYatesShuffle(input, seededRng(7))).toEqual(
      fisherYatesShuffle(input, seededRng(7)),
    );
  });

  test("follows the Fisher–Yates swap order", () => {
    // rng always 0 → each step swaps position i with position 0:
    // [1,2,3] → i=2 swaps with 0 → [3,2,1] → i=1 swaps with 0 → [2,3,1]
    const alwaysZero: Rng = () => 0;
    expect(fisherYatesShuffle([1, 2, 3], alwaysZero)).toEqual([2, 3, 1]);
  });

  test("handles empty and single-element arrays", () => {
    expect(fisherYatesShuffle([], seededRng(1))).toEqual([]);
    expect(fisherYatesShuffle(["only"], seededRng(1))).toEqual(["only"]);
  });
});

describe("computeGroupAssignments", () => {
  const teams = (n: number) => Array.from({ length: n }, (_, i) => `team${i}`);

  test("even split: 8 teams into 4 groups of 2", () => {
    const result = computeGroupAssignments(teams(8), 4, seededRng(1));
    expect(result).toHaveLength(8);
    expect(result.map((a) => a.slotLabel)).toEqual([
      "A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2",
    ]);
    // Every team assigned exactly once
    expect(new Set(result.map((a) => a.teamId)).size).toBe(8);
  });

  test("uneven split: 10 teams into 3 groups → 4/3/3", () => {
    const result = computeGroupAssignments(teams(10), 3, seededRng(2));
    const byGroup = (g: string) => result.filter((a) => a.group === g);
    expect(byGroup("A")).toHaveLength(4);
    expect(byGroup("B")).toHaveLength(3);
    expect(byGroup("C")).toHaveLength(3);
    expect(byGroup("A").map((a) => a.slot)).toEqual([1, 2, 3, 4]);
    expect(new Set(result.map((a) => a.teamId)).size).toBe(10);
  });

  test("single group holds every team in sequential slots", () => {
    const result = computeGroupAssignments(teams(5), 1, seededRng(3));
    expect(result.every((a) => a.group === "A")).toBe(true);
    expect(result.map((a) => a.slot)).toEqual([1, 2, 3, 4, 5]);
  });

  test("groups == teams: one team per group, all slot 1", () => {
    const result = computeGroupAssignments(teams(4), 4, seededRng(4));
    expect(result.map((a) => a.slotLabel)).toEqual(["A1", "B1", "C1", "D1"]);
    expect(new Set(result.map((a) => a.group)).size).toBe(4);
    expect(new Set(result.map((a) => a.teamId)).size).toBe(4);
  });

  test("is deterministic for a given rng and randomizes across seeds", () => {
    const a = computeGroupAssignments(teams(10), 3, seededRng(5));
    const b = computeGroupAssignments(teams(10), 3, seededRng(5));
    expect(a).toEqual(b);

    // With 10 teams it is astronomically unlikely two seeds agree; check a
    // couple to guard against an accidentally constant shuffle.
    const c = computeGroupAssignments(teams(10), 3, seededRng(6));
    const d = computeGroupAssignments(teams(10), 3, seededRng(7));
    const orders = new Set(
      [a, c, d].map((r) => r.map((x) => x.teamId).join(",")),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  test("throws on invalid configurations", () => {
    expect(() => computeGroupAssignments(teams(3), 4)).toThrow(
      /cannot exceed/,
    );
    expect(() => computeGroupAssignments(teams(3), 0)).toThrow(
      /at least 1 group/,
    );
    expect(() => computeGroupAssignments([], 1)).toThrow(/Add teams/);
  });
});
