// lib/useConnectionView.ts - Live connection state for the indicator and the
// overlay (lib/connection.ts has the rules). Ticks once a second only while
// the socket is down.
'use client';

import { useEffect, useState } from 'react';
import { useConvexConnectionState } from 'convex/react';
import { connectionView, type ConnectionView } from './connection';

export function useConnectionView(): ConnectionView {
  const state = useConvexConnectionState();
  const disconnected = state.hasEverConnected && !state.isWebSocketConnected;
  const [downSince, setDownSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!disconnected) return;
    const start = Date.now();
    const raf = requestAnimationFrame(() => {
      setDownSince(start);
      setNow(start);
    });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(tick);
      setDownSince(null);
    };
  }, [disconnected]);

  return connectionView({
    hasEverConnected: state.hasEverConnected,
    connected: !disconnected,
    downSince,
    now,
  });
}
