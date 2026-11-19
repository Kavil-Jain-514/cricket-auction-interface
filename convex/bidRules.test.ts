import { describe, expect, test } from "vitest";
import {
  DEFAULT_BASE_PRICE,
  effectiveBasePrice,
  incrementFor,
  isSquadFull,
  nextMinimumBid,
  maxAllowedBid,
  reserveBasePrice,
  formatPrice,
} from "./bidRules";

describe("isSquadFull", () => {
  test("is false below the limit and true at or above it", () => {
    expect(isSquadFull(2, 3)).toBe(false);
    expect(isSquadFull(3, 3)).toBe(true);
    expect(isSquadFull(4, 3)).toBe(true);
  });
});

describe("maxAllowedBid", () => {
  test("is 0 when the squad is full", () => {
    expect(
      maxAllowedBid({
        purseRemaining: 1_000_000,
        playersOnTeam: 3,
        maxPlayersPerTeam: 3,
        reservePrice: 100_000,
      }),
    ).toBe(0);
  });

  test("is 0 when the squad is over-full", () => {
    expect(
      maxAllowedBid({
        purseRemaining: 1_000_000,
        playersOnTeam: 4,
        maxPlayersPerTeam: 3,
        reservePrice: 100_000,
      }),
    ).toBe(0);
  });

  test("is the whole purse when one slot is left", () => {
    expect(
      maxAllowedBid({
        purseRemaining: 750_000,
        playersOnTeam: 2,
        maxPlayersPerTeam: 3,
        reservePrice: 100_000,
      }),
    ).toBe(750_000);
  });

  test("reserves the other open slots at the reserve price", () => {
    // 3 slots open → reserve 2 × 100k.
    expect(
      maxAllowedBid({
        purseRemaining: 1_000_000,
        playersOnTeam: 0,
        maxPlayersPerTeam: 3,
        reservePrice: 100_000,
      }),
    ).toBe(800_000);
  });

  test("is 0 with a zero purse", () => {
    expect(
      maxAllowedBid({
        purseRemaining: 0,
        playersOnTeam: 0,
        maxPlayersPerTeam: 3,
        reservePrice: 100_000,
      }),
    ).toBe(0);
  });

  test("is floored at 0 when the reserve exceeds the purse", () => {
    expect(
      maxAllowedBid({
        purseRemaining: 150_000,
        playersOnTeam: 0,
        maxPlayersPerTeam: 3,
        reservePrice: 100_000,
      }),
    ).toBe(0);
  });
});

describe("reserveBasePrice", () => {
  test("prefers the cheapest pending base price over the current player's", () => {
    expect(
      reserveBasePrice({
        minPendingBasePrice: 100_000,
        currentPlayerBasePrice: 500_000,
        tournamentBasePrice: 200_000,
      }),
    ).toBe(100_000);
  });

  test("falls back to the current player's base price when nothing is pending", () => {
    expect(
      reserveBasePrice({
        minPendingBasePrice: undefined,
        currentPlayerBasePrice: 500_000,
        tournamentBasePrice: 200_000,
      }),
    ).toBe(500_000);
  });

  test("falls back to the tournament base price, then the default", () => {
    expect(
      reserveBasePrice({
        minPendingBasePrice: undefined,
        currentPlayerBasePrice: undefined,
        tournamentBasePrice: 200_000,
      }),
    ).toBe(200_000);
    expect(
      reserveBasePrice({
        minPendingBasePrice: undefined,
        currentPlayerBasePrice: undefined,
        tournamentBasePrice: undefined,
      }),
    ).toBe(DEFAULT_BASE_PRICE);
    expect(DEFAULT_BASE_PRICE).toBe(100_000);
  });

  test("mixed base prices: a pending ₹1L player sets the reserve for a ₹5L lot", () => {
    const reservePrice = reserveBasePrice({
      minPendingBasePrice: 100_000,
      currentPlayerBasePrice: 500_000,
      tournamentBasePrice: 100_000,
    });
    expect(
      maxAllowedBid({
        purseRemaining: 1_000_000,
        playersOnTeam: 0,
        maxPlayersPerTeam: 3,
        reservePrice,
      }),
    ).toBe(800_000);
  });
});

describe("nextMinimumBid — increment slabs", () => {
  const slabs = [
    { fromAmount: 0, increment: 25_000 },
    { fromAmount: 500_000, increment: 50_000 },
    { fromAmount: 1_000_000, increment: 100_000 },
  ];

  test("no slabs: currentBid + minBidIncrement, exactly as before", () => {
    expect(nextMinimumBid(475_000, undefined, 25_000)).toBe(500_000);
    expect(nextMinimumBid(475_000, [], 25_000)).toBe(500_000);
  });

  test("uses the band the current bid sits in", () => {
    expect(nextMinimumBid(100_000, slabs, 10_000)).toBe(125_000);
    expect(nextMinimumBid(475_000, slabs, 10_000)).toBe(500_000);
  });

  test("exactly at a boundary uses the new band", () => {
    expect(nextMinimumBid(500_000, slabs, 10_000)).toBe(550_000);
    expect(nextMinimumBid(499_999, slabs, 10_000)).toBe(524_999);
    expect(nextMinimumBid(1_000_000, slabs, 10_000)).toBe(1_100_000);
  });

  test("below the first slab falls back to minBidIncrement", () => {
    const fromFive = [{ fromAmount: 500_000, increment: 50_000 }];
    expect(incrementFor(200_000, fromFive, 20_000)).toBe(20_000);
    expect(incrementFor(500_000, fromFive, 20_000)).toBe(50_000);
  });
});

describe("effectiveBasePrice — player, then category, then tournament", () => {
  const settings = {
    basePrice: 150_000,
    categories: [
      { id: "marquee", name: "Marquee", basePrice: 500_000, order: 0, colour: "#f59e0b" },
    ],
  };

  test("a player's own base price wins", () => {
    expect(effectiveBasePrice({ basePrice: 80_000, categoryId: "marquee" }, settings)).toBe(80_000);
  });

  test("falls back to the player's category", () => {
    expect(effectiveBasePrice({ categoryId: "marquee" }, settings)).toBe(500_000);
  });

  test("an unknown or absent category falls back to the tournament", () => {
    expect(effectiveBasePrice({ categoryId: "gone" }, settings)).toBe(150_000);
    expect(effectiveBasePrice({}, settings)).toBe(150_000);
  });

  test("no tournament base price: the legacy default", () => {
    expect(effectiveBasePrice({}, {})).toBe(DEFAULT_BASE_PRICE);
  });
});

describe("formatPrice: the unit follows the amount", () => {
  test.each([
    [0, "₹0"],
    [500, "₹500"],
    [2_500, "₹2,500"],
    [45_000, "₹45,000"],
    [99_999, "₹99,999"],
    [100_000, "₹1.00L"],
    [150_000, "₹1.50L"],
    [1_234_567, "₹12.34L"], // cut, not rounded: never shows more than there is
    [1_229_000, "₹12.29L"], // exact in integers (12.29 * 100 is 1228.99… in floats)
    [575_000, "₹5.75L"],
    [9_999_999, "₹99.99L"],
    [10_000_000, "₹1.00Cr"],
    [125_000_000, "₹12.50Cr"],
    [1_000_000_000, "₹100.00Cr"],
    [-25_000, "-₹25,000"],
    [-150_000, "-₹1.50L"],
  ])("%d -> %s", (amount, text) => {
    expect(formatPrice(amount)).toBe(text);
  });

  test("never rounds up into a unit it hasn't reached", () => {
    // 99,99,999 would round to "100.00L"; it must stay below a crore.
    expect(formatPrice(9_999_999)).toBe("₹99.99L");
    expect(formatPrice(99_999_999)).toBe("₹9.99Cr");
  });

  test("another symbol, for PDFs whose font has no ₹", () => {
    expect(formatPrice(45_000, "Rs.")).toBe("Rs.45,000");
    expect(formatPrice(150_000, "Rs.")).toBe("Rs.1.50L");
  });
});
