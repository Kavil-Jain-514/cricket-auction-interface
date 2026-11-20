// lib/retryWhenBusy.ts - Retry a call the server refused only because the
// tournament is busy (the per-tournament rate limits on the public
// registration form, convex/registrations.ts). Nothing else is retried:
// validation errors, "closed", the per-phone daily limit ("...from this phone
// number today") and unknown failures go straight back to the caller.
// A busy refusal is a ConvexError thrown before anything is written, so a
// retry can never register someone twice.
import { getErrorMessage } from "./utils";

const BUSY = /^Too many (registrations|uploads) right now/;

export function isBusyError(error: unknown): boolean {
  return BUSY.test(getErrorMessage(error, ""));
}

export type RetryOptions = {
  /** Total tries, the first included. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Called before each wait, with the retry number (1 = first retry). */
  onRetry?: (retry: number) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

/** Run `fn`; on a busy refusal wait (exponential backoff, full jitter) and try again. */
export async function retryWhenBusy<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    attempts = 6,
    baseDelayMs = 1000,
    maxDelayMs = 10_000,
    onRetry,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
  } = opts;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isBusyError(error)) throw error;
      onRetry?.(attempt);
      const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      // At least half the cap, so a retry never fires straight back into the rush.
      await sleep(Math.round(cap / 2 + (random() * cap) / 2));
    }
  }
}
