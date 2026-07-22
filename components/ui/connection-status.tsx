"use client";

// Connection-state indicator (AUDIT P1-1).
//
// Convex auto-reconnects and resyncs full query state on reconnect, so data is
// never wrong or partially replayed — but during a drop the UI silently freezes
// on the last value with no signal. For a team owner bidding on venue wifi, that
// means bidding against a stale number without knowing. This surfaces a clear
// "Reconnecting…" badge whenever the socket is down, so staleness is never
// invisible. It disappears the moment the socket is back (and the fresh state
// has already been resynced by Convex).

import { useEffect, useState } from "react";
import { useConvexConnectionState } from "convex/react";
import { WifiOff } from "lucide-react";

export function ConnectionStatus() {
  const state = useConvexConnectionState();
  // `debounced` flips true only after the socket has been down for ~1.2s.
  const [debounced, setDebounced] = useState(false);

  // Only after the client has connected at least once — otherwise the initial
  // page-load spinner already covers "connecting". `disconnected` is a stable
  // boolean, so this effect re-runs only when it actually flips (not on every
  // inflight-request tick that useConvexConnectionState re-renders on). All
  // state writes happen asynchronously (timeout / cleanup), never synchronously
  // in the effect body.
  const disconnected = state.hasEverConnected && !state.isWebSocketConnected;

  useEffect(() => {
    if (!disconnected) return;
    const id = setTimeout(() => setDebounced(true), 1200);
    // On reconnect (or unmount) clear the timer and reset the debounce flag so
    // the next drop debounces afresh.
    return () => {
      clearTimeout(id);
      setDebounced(false);
    };
  }, [disconnected]);

  if (!disconnected || !debounced) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-full border border-amber-400/60 bg-amber-500/95 px-4 py-2 text-sm font-semibold text-amber-950 shadow-2xl backdrop-blur"
    >
      <WifiOff className="h-4 w-4 animate-pulse" />
      Reconnecting…
    </div>
  );
}
