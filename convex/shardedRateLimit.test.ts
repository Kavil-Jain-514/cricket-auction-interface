/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { consumeShardedRateLimit, perShardLimit, RATE_LIMIT_SHARDS, shardOf } from "./shardedRateLimit";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const MINUTE = 60 * 1000;
const T0 = new Date("2026-11-19T10:00:05Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("shardOf", () => {
  test("is deterministic and always a valid shard", () => {
    for (const seed of ["", "9876543210", "cricket-auction/registrations/abc", "🏏"]) {
      const s = shardOf(seed);
      expect(s).toBe(shardOf(seed));
      expect(Number.isInteger(s) && s >= 0 && s < RATE_LIMIT_SHARDS).toBe(true);
    }
  });

  test("spreads sequential phone numbers over every shard", () => {
    const counts = new Array(RATE_LIMIT_SHARDS).fill(0);
    for (let i = 0; i < 20 * RATE_LIMIT_SHARDS; i++) counts[shardOf(String(9876500000 + i))]++;
    expect(counts.every((c) => c > 0)).toBe(true);
  });
});

describe("perShardLimit", () => {
  test("is the limit's share, rounded up, never 0", () => {
    expect(RATE_LIMIT_SHARDS).toBe(64);
    expect(perShardLimit(600)).toBe(10);
    expect(perShardLimit(900)).toBe(15);
    expect(perShardLimit(2000)).toBe(32);
    expect(perShardLimit(1)).toBe(1);
    expect(perShardLimit(600, 16)).toBe(38);
  });
});

describe("consumeShardedRateLimit", () => {
  // Every shard holds 2.
  const TOTAL = 2 * RATE_LIMIT_SHARDS;
  const LIMIT = { limit: TOTAL, windowMs: MINUTE };
  const rows = (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) => {
      const all = await ctx.db.query("rateLimits").collect();
      return Object.fromEntries(all.map((r) => [r.key, r.count]));
    });

  test("one shard stops at its share; the next request moves to another shard, which is unaffected until then", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: T0 });
    const t = convexTest(schema, modules);
    const s = shardOf("seed");
    const next = (s + 1) % RATE_LIMIT_SHARDS;
    const consume = () => t.run((ctx) => consumeShardedRateLimit(ctx, "k", LIMIT, "seed"));

    expect(await consume()).toBe(true);
    expect(await consume()).toBe(true);
    expect(await rows(t)).toEqual({ [`k:${s}`]: 2 });

    expect(await consume()).toBe(true);
    expect(await rows(t)).toEqual({ [`k:${s}`]: 2, [`k:${next}`]: 1 });
  });

  test("the total is capped at shards × share, and a refusal writes nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: T0 });
    const t = convexTest(schema, modules);
    for (let i = 0; i < TOTAL; i++) {
      expect(await t.run((ctx) => consumeShardedRateLimit(ctx, "k", LIMIT, `seed-${i}`))).toBe(true);
    }
    const before = await rows(t);
    expect(Object.values(before)).toEqual(new Array(RATE_LIMIT_SHARDS).fill(2));
    expect(await t.run((ctx) => consumeShardedRateLimit(ctx, "k", LIMIT, "one-more"))).toBe(false);
    expect(await rows(t)).toEqual(before);
  });

  test("keys don't share shards", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: T0 });
    const t = convexTest(schema, modules);
    for (let i = 0; i < TOTAL; i++) await t.run((ctx) => consumeShardedRateLimit(ctx, "a", LIMIT, `seed-${i}`));
    expect(await t.run((ctx) => consumeShardedRateLimit(ctx, "b", LIMIT, "seed"))).toBe(true);
  });

  test("the limit resets when the fixed window rolls over", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: T0 });
    const t = convexTest(schema, modules);
    for (let i = 0; i < TOTAL; i++) await t.run((ctx) => consumeShardedRateLimit(ctx, "k", LIMIT, `seed-${i}`));
    expect(await t.run((ctx) => consumeShardedRateLimit(ctx, "k", LIMIT, "late"))).toBe(false);
    vi.setSystemTime(T0.getTime() + MINUTE);
    expect(await t.run((ctx) => consumeShardedRateLimit(ctx, "k", LIMIT, "late"))).toBe(true);
  });
});

describe("purgeOldWindows", () => {
  test("deletes windows older than a day in batches, rescheduling itself until none are left", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 1005; i++) await ctx.db.insert("rateLimits", { key: `old:${i}`, windowStart: 0, count: 1 });
      await ctx.db.insert("rateLimits", { key: "fresh", windowStart: Date.now(), count: 1 });
    });
    expect(await t.mutation(internal.rateLimit.purgeOldWindows, {})).toEqual({ deleted: 1000 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const left = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(left.map((r) => r.key)).toEqual(["fresh"]);
  });
});
