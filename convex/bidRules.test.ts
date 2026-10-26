import { describe, expect, test } from "vitest";
import {
  DEFAULT_BASE_PRICE,
  isSquadFull,
  maxAllowedBid,
  reserveBasePrice,
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
