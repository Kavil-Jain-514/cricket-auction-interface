// convex/rateLimit.ts - Fixed-window rate limits for public, anonymous entry
// points (AUDIT 2026-10 P1-9). Convex mutations can't see the caller's IP, so
// limits are per resource (e.g. per tournament): they cap what a spammer can
// cost us, while a real registration rush stays well under them.
import { internalMutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const PURGE_BATCH = 1000;

/** Count one hit on `key`; false when the window's limit is already used. */
export async function consumeRateLimit(
  ctx: MutationCtx,
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<boolean> {
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  if (!row || row.windowStart !== windowStart) {
    if (row) await ctx.db.patch(row._id, { windowStart, count: 1 });
    else await ctx.db.insert("rateLimits", { key, windowStart, count: 1 });
    return true;
  }
  if (row.count >= limit) return false;
  await ctx.db.patch(row._id, { count: row.count + 1 });
  return true;
}

/** For actions, which can't write: count one hit, false when over. */
export const consume = internalMutation({
  args: { key: v.string(), limit: v.number(), windowMs: v.number() },
  handler: (ctx, args) => consumeRateLimit(ctx, args.key, args),
});

/**
 * Daily cron (convex/crons.ts): drop windows older than a day, in batches.
 * Sharded limits (shardedRateLimit.ts) keep 16 rows per key, so a full batch
 * schedules the next one instead of leaving the rest for tomorrow.
 */
export const purgeOldWindows = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const old = await ctx.db
      .query("rateLimits")
      .withIndex("by_windowStart", (q) => q.lt("windowStart", Date.now() - 24 * 60 * 60 * 1000))
      .take(PURGE_BATCH);
    await Promise.all(old.map((row) => ctx.db.delete(row._id)));
    if (old.length === PURGE_BATCH) await ctx.scheduler.runAfter(0, internal.rateLimit.purgeOldWindows, {});
    return { deleted: old.length };
  },
});
