"use client";

// Connection-state indicator (AUDIT P1-1, AUDIT 2026-10 P1-13).
//
// Convex auto-reconnects and resyncs full query state on reconnect, so data is
// never wrong or partially replayed — but during a drop the UI silently freezes
// on the last value. This makes staleness visible: "Reconnecting… · last update
// 12s ago", with a Reload button once it has been stale for a while (iOS can
// resume a backgrounded tab with a dead socket). Rules: lib/connection.ts.

import { RefreshCw, WifiOff } from "lucide-react";
import { useConnectionView } from "@/lib/useConnectionView";

/** `showLive`: also show a small "Live" dot while connected (the console). */
export function ConnectionStatus({ showLive = false }: { showLive?: boolean }) {
  const view = useConnectionView();

  if (view.kind === "live") {
    if (!showLive) return null;
    return (
      <div
        role="status"
        className="fixed bottom-4 left-4 z-[100] flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-slate-950/80 px-2.5 py-1 text-xs font-semibold text-emerald-300 backdrop-blur"
      >
        <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
        Live
      </div>
    );
  }
  if (view.kind !== "reconnecting") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-full border border-amber-400/60 bg-amber-500/95 px-4 py-2 text-sm font-semibold text-amber-950 shadow-2xl backdrop-blur"
    >
      <WifiOff className="h-4 w-4 animate-pulse" />
      Reconnecting… · last update {view.secondsStale}s ago
      {view.offerReload && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-950/90 px-2.5 py-0.5 text-xs text-amber-100"
        >
          <RefreshCw className="h-3 w-3" /> Reload
        </button>
      )}
    </div>
  );
}
