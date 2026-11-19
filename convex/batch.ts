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
