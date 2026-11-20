// convex/shardedRateLimit.ts - A per-resource rate limit spread over several
// rows, for limits that many anonymous people hit at the same moment (the
// public registration form).
//
// Why: consumeRateLimit keeps one row per key, which every request reads and
// patches. In a rush they all conflict on it (OCC); the load test
// (scripts/loadtest/registrations.mjs) saw 400+ forced reconnects, 7-15 s
// tails and failed photo signatures at 200-300 simultaneous registrants.
// Spread over RATE_LIMIT_SHARDS rows, concurrent requests mostly touch
// different rows.
//
// How: each shard is an ordinary fixed window (consumeRateLimit, same window
// boundaries, false when full, no write on refusal) holding the limit's share,
// rounded up. A request starts at the shard picked by `seed`; if that shard is
// full it moves on to the next, so nobody is refused until every shard is
// full. The cap is therefore shards × share: at most limit + shards - 1, never
// the 1.5× a fixed-shard design needs to keep false refusals rare. The extra
// reads only happen when a shard is already full, i.e. near the cap.
//
// Seeds: callers pass a server-generated value (a random number for submit,
// the server-chosen upload public_id for signatures), never the phone number
// or anything else the client picks. Even a client-chosen seed could not get
// past the cap (the total is fixed) or block one shard's users (a full shard
// overflows to the next), but a random seed also keeps a spammer's requests
// spread out instead of piling onto one row.
import type { MutationCtx } from "./_generated/server";
import { consumeRateLimit } from "./rateLimit";

// 64, not 16: at 16 the load test still saw ~30 simultaneous writers per row
// at N=500 and a few requests ran out of OCC retries (2026-11-20, dev).
export const RATE_LIMIT_SHARDS = 64;

/** FNV-1a (32-bit) of `seed`, as a shard number. */
export function shardOf(seed: string, shards: number = RATE_LIMIT_SHARDS): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % shards;
}

/** Each shard's share of `limit`, rounded up so the total is at least `limit`. */
export function perShardLimit(limit: number, shards: number = RATE_LIMIT_SHARDS): number {
  return Math.max(1, Math.ceil(limit / shards));
}

/**
 * Count one hit on `key`, on the first shard with room starting from
 * shardOf(seed). False when every shard's window is full; nothing is written
 * then. Rows are keyed `<key>:<shard>`.
 */
export async function consumeShardedRateLimit(
  ctx: MutationCtx,
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
  seed: string,
  shards: number = RATE_LIMIT_SHARDS,
): Promise<boolean> {
  const share = { limit: perShardLimit(limit, shards), windowMs };
  const start = shardOf(seed, shards);
  for (let k = 0; k < shards; k++) {
    if (await consumeRateLimit(ctx, `${key}:${(start + k) % shards}`, share)) return true;
  }
  return false;
}
