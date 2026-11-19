// convex/batch.ts - Running many writes inside one mutation.

/**
 * Run `thunks` a chunk at a time, so only one chunk of writes is in flight
 * at once. This does NOT make a transaction smaller: everything still commits
 * (or fails) as one mutation, within Convex's per-transaction limits
 * (AUDIT 2026-11 PERF-004).
 */
export async function inChunks<T>(thunks: Array<() => Promise<T>>, chunkSize = 200): Promise<void> {
  for (let i = 0; i < thunks.length; i += chunkSize) {
    await Promise.all(thunks.slice(i, i + chunkSize).map((fn) => fn()));
  }
}

/**
 * Most documents a whole-tournament operation (restart, delete, restore,
 * end rehearsal) may touch in its one transaction. Above this, Convex's
 * per-transaction limits on documents read and written would fail the
 * mutation part-way through its work with an opaque error; we refuse up front
 * with a clear one instead (AUDIT 2026-11 PERF-004). Chosen from Convex's
 * documented limits (writes ~8k documents, reads ~16k; these operations read
 * everything twice, once for the safety snapshot): re-check against
 * https://docs.convex.dev/production/state/limits when they change.
 */
export const MAX_ROWS_PER_OPERATION = 7_500;

/** Throws a readable error when `rows` is more than one transaction can safely rewrite. */
export function assertFitsOneTransaction(rows: number, action: string): void {
  if (rows > MAX_ROWS_PER_OPERATION) {
    throw new Error(
      `This tournament is too large to ${action} in one step (${rows.toLocaleString("en-IN")} records). Contact Bid11Pro support.`,
    );
  }
}
