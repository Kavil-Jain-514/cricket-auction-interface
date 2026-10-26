import { describe, expect, test } from "vitest";
import {
  normalizePhone,
  validateCategories,
  validateIncrementSlabs,
  validateAge,
  validateJersey,
  validateOwnerName,
  validatePlayerName,
  validateSettings,
  validateTeamName,
  validateTournamentName,
} from "./validation";

const goodSettings = {
  basePurse: 1_000_000,
  minBidIncrement: 25_000,
  maxPlayersPerTeam: 15,
  basePrice: 100_000,
};

describe("validateTournamentName", () => {
  test("accepts 3–50 characters after trimming", () => {
    expect(validateTournamentName("IPL")).toBeNull();
    expect(validateTournamentName("x".repeat(50))).toBeNull();
  });
  test("rejects too short or too long", () => {
    expect(validateTournamentName("  ab  ")).toMatch(/at least 3/);
    expect(validateTournamentName("x".repeat(51))).toMatch(/50/);
  });
});

describe("validateSettings", () => {
  test("accepts sane settings", () => {
    expect(validateSettings(goodSettings)).toBeNull();
    expect(
      validateSettings({ ...goodSettings, basePrice: undefined }),
    ).toBeNull();
  });
  test("rejects NaN, zero and negative values", () => {
    for (const key of [
      "basePurse",
      "minBidIncrement",
      "maxPlayersPerTeam",
      "basePrice",
    ] as const) {
      for (const bad of [NaN, 0, -1]) {
        expect(validateSettings({ ...goodSettings, [key]: bad })).not.toBeNull();
      }
    }
  });
  test("enforces the purse range", () => {
    expect(validateSettings({ ...goodSettings, basePurse: 99_999 })).toMatch(
      /purse/i,
    );
    expect(
      validateSettings({ ...goodSettings, basePurse: 1_000_000_001 }),
    ).toMatch(/purse/i);
  });
  test("enforces the increment range", () => {
    expect(
      validateSettings({ ...goodSettings, minBidIncrement: 4_999 }),
    ).toMatch(/increment/i);
    expect(
      validateSettings({ ...goodSettings, minBidIncrement: 100_001 }),
    ).toMatch(/10%/);
  });
  test("max players must be an integer 1–50", () => {
    expect(
      validateSettings({ ...goodSettings, maxPlayersPerTeam: 2.5 }),
    ).toMatch(/players/i);
    expect(
      validateSettings({ ...goodSettings, maxPlayersPerTeam: 51 }),
    ).toMatch(/players/i);
  });
  test("base price cannot exceed the purse", () => {
    expect(
      validateSettings({ ...goodSettings, basePrice: 1_000_001 }),
    ).toMatch(/base price/i);
  });
});

describe("team and owner names", () => {
  test("team name is 2–29 characters", () => {
    expect(validateTeamName("RCB")).toBeNull();
    expect(validateTeamName("x".repeat(29))).toBeNull();
    expect(validateTeamName("x")).not.toBeNull();
    expect(validateTeamName("x".repeat(30))).not.toBeNull();
  });
  test("owner name is at least 2 characters", () => {
    expect(validateOwnerName("Al")).toBeNull();
    expect(validateOwnerName(" A ")).not.toBeNull();
  });
});

describe("player fields", () => {
  test("player name is 2–49 characters", () => {
    expect(validatePlayerName("Jo")).toBeNull();
    expect(validatePlayerName("x".repeat(49))).toBeNull();
    expect(validatePlayerName("J")).not.toBeNull();
    expect(validatePlayerName("x".repeat(50))).not.toBeNull();
  });
  test("jersey is an integer 1–99", () => {
    expect(validateJersey(1)).toBeNull();
    expect(validateJersey(99)).toBeNull();
    expect(validateJersey(0)).not.toBeNull();
    expect(validateJersey(100)).not.toBeNull();
    expect(validateJersey(7.5)).not.toBeNull();
    expect(validateJersey(NaN)).not.toBeNull();
  });
  test("age is 0 (unknown) or 5–80", () => {
    expect(validateAge(0)).toBeNull();
    expect(validateAge(5)).toBeNull();
    expect(validateAge(80)).toBeNull();
    expect(validateAge(4)).not.toBeNull();
    expect(validateAge(81)).not.toBeNull();
    expect(validateAge(NaN)).not.toBeNull();
  });
});

describe("normalizePhone", () => {
  test("accepts common Indian formats and returns 10 digits", () => {
    for (const raw of [
      "9876543210",
      "+91 98765-43210",
      "+919876543210",
      "09876543210",
      "98765 43210",
    ]) {
      expect(normalizePhone(raw)).toEqual({ ok: true, phone: "9876543210" });
    }
  });
  test("empty or missing phone is allowed", () => {
    expect(normalizePhone(undefined)).toEqual({ ok: true, phone: undefined });
    expect(normalizePhone("  ")).toEqual({ ok: true, phone: undefined });
  });
  test("rejects anything that is not 10 digits", () => {
    expect(normalizePhone("12345").ok).toBe(false);
    expect(normalizePhone("98765abcde").ok).toBe(false);
    expect(normalizePhone("+1 9876543210").ok).toBe(false);
  });
});

const marquee = { id: "marquee", name: "Marquee", basePrice: 500_000, order: 0, colour: "#f59e0b" };

describe("validateCategories", () => {
  test("accepts a valid list (and an empty one)", () => {
    expect(validateCategories([], 10_000_000)).toBeNull();
    expect(
      validateCategories(
        [marquee, { id: "a", name: "Set A", basePrice: 200_000, order: 1, colour: "#2563eb" }],
        10_000_000,
      ),
    ).toBeNull();
  });

  test("rejects blank or duplicate names and ids", () => {
    expect(validateCategories([{ ...marquee, name: "  " }], 10_000_000)).not.toBeNull();
    expect(validateCategories([marquee, { ...marquee, id: "m2", name: "marquee" }], 10_000_000)).not.toBeNull();
    expect(validateCategories([marquee, { ...marquee, name: "Other" }], 10_000_000)).not.toBeNull();
    expect(validateCategories([{ ...marquee, id: "" }], 10_000_000)).not.toBeNull();
  });

  test("rejects a bad base price or colour", () => {
    for (const basePrice of [0, -1, NaN, 20_000_000]) {
      expect(validateCategories([{ ...marquee, basePrice }], 10_000_000)).not.toBeNull();
    }
    expect(validateCategories([{ ...marquee, colour: "orange" }], 10_000_000)).not.toBeNull();
  });
});

describe("validateIncrementSlabs", () => {
  test("accepts strictly ascending slabs (and none)", () => {
    expect(validateIncrementSlabs([], 10_000_000)).toBeNull();
    expect(
      validateIncrementSlabs(
        [
          { fromAmount: 0, increment: 25_000 },
          { fromAmount: 500_000, increment: 50_000 },
        ],
        10_000_000,
      ),
    ).toBeNull();
  });

  test("rejects unsorted or duplicate thresholds", () => {
    expect(
      validateIncrementSlabs(
        [
          { fromAmount: 500_000, increment: 50_000 },
          { fromAmount: 0, increment: 25_000 },
        ],
        10_000_000,
      ),
    ).not.toBeNull();
    expect(
      validateIncrementSlabs(
        [
          { fromAmount: 0, increment: 25_000 },
          { fromAmount: 0, increment: 50_000 },
        ],
        10_000_000,
      ),
    ).not.toBeNull();
  });

  test("rejects increments below ₹5,000 or above 10% of the purse, and negative thresholds", () => {
    expect(validateIncrementSlabs([{ fromAmount: 0, increment: 1_000 }], 10_000_000)).not.toBeNull();
    expect(validateIncrementSlabs([{ fromAmount: 0, increment: 2_000_000 }], 10_000_000)).not.toBeNull();
    expect(validateIncrementSlabs([{ fromAmount: -1, increment: 25_000 }], 10_000_000)).not.toBeNull();
  });
});
