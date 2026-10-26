import { describe, expect, test } from "vitest";
import {
  bidTimerOptions,
  remainingMs,
  sampleClockOffset,
  timerTone,
} from "./bidTimer";

describe("sampleClockOffset", () => {
  test("first sample is serverTime - clientNow (either sign)", () => {
    expect(sampleClockOffset(undefined, 10_000, 8_000)).toBe(2_000);
    expect(sampleClockOffset(undefined, 8_000, 10_000)).toBe(-2_000);
  });

  test("a stale (cached) sample never lowers the estimate", () => {
    const fresh = sampleClockOffset(undefined, 100_000, 99_000); // +1s skew
    // A cached result from 60s ago arrives later: serverTime looks far behind.
    expect(sampleClockOffset(fresh, 41_000, 101_000)).toBe(1_000);
  });

  test("a fresher sample raises the estimate", () => {
    const stale = sampleClockOffset(undefined, 40_000, 100_000); // -60s
    expect(sampleClockOffset(stale, 101_000, 100_500)).toBe(500);
  });
});

describe("remainingMs", () => {
  test("uses server time = clientNow + offset", () => {
    // Server is 2s ahead; ends 30s after server's 10_000.
    expect(remainingMs(40_000, 2_000, 8_000, 30)).toBe(30_000);
    expect(remainingMs(40_000, 2_000, 18_000, 30)).toBe(20_000);
  });

  test("clamps to [0, timerSeconds]", () => {
    expect(remainingMs(40_000, 0, 50_000, 30)).toBe(0);
    // Stale offset would show 90s; clamp to the configured 30s.
    expect(remainingMs(40_000, -60_000, 10_000, 30)).toBe(30_000);
  });
});

describe("timerTone", () => {
  test("amber at 10s, red at 5s", () => {
    expect(timerTone(11)).toBe("normal");
    expect(timerTone(10)).toBe("amber");
    expect(timerTone(6)).toBe("amber");
    expect(timerTone(5)).toBe("red");
    expect(timerTone(0)).toBe("red");
  });
});

describe("bidTimerOptions", () => {
  test("keeps a stored value that is not a preset, in order", () => {
    expect(bidTimerOptions(30)).toContain(0);
    expect(bidTimerOptions(25)).toEqual([0, 10, 15, 20, 25, 30, 45, 60, 90, 120]);
  });
});
