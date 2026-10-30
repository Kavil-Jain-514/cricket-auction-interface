// lib/connection.ts - What the connection indicator shows (AUDIT 2026-10
// P1-13). Pure, so the thresholds are unit-tested apart from React.

export type ConnectionView =
  | { kind: 'connecting' }
  | { kind: 'live' }
  | { kind: 'reconnecting'; secondsStale: number; offerReload: boolean };

/** Shorter drops are ordinary blips and read as live. */
export const RECONNECT_DEBOUNCE_MS = 1_200;
/** iOS can resume a backgrounded tab with a dead socket: offer a reload. */
export const OFFER_RELOAD_AFTER_S = 15;

export function connectionView({
  hasEverConnected,
  connected,
  downSince,
  now,
}: {
  hasEverConnected: boolean;
  connected: boolean;
  /** When the socket was last seen dropping; null while connected. */
  downSince: number | null;
  now: number;
}): ConnectionView {
  if (!hasEverConnected) return { kind: 'connecting' };
  if (connected || downSince === null || now - downSince < RECONNECT_DEBOUNCE_MS) {
    return { kind: 'live' };
  }
  const secondsStale = Math.floor((now - downSince) / 1000);
  return { kind: 'reconnecting', secondsStale, offerReload: secondsStale >= OFFER_RELOAD_AFTER_S };
}
