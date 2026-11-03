// lib/wakeLock.ts - Keep the projector / console / overlay screen on during
// an auction (AUDIT 2026-10 P1-13). Browsers drop the lock whenever the tab
// is hidden, so it is re-requested each time the tab is visible again.
'use client';

import { useEffect } from 'react';

type WakeLockNavigator = { wakeLock?: { request(type: 'screen'): Promise<{ released: boolean; release(): Promise<void> }> } };
type VisibilityDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

/** Hold a screen wake lock until the returned stop() is called. No-op without the API. */
export function keepScreenAwake(nav: WakeLockNavigator, doc: VisibilityDocument): () => void {
  if (!nav.wakeLock) return () => {};
  let sentinel: { released: boolean; release(): Promise<void> } | null = null;
  let stopped = false;

  const acquire = async () => {
    if (stopped || doc.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
    try {
      sentinel = await nav.wakeLock!.request('screen');
      if (stopped) await sentinel.release();
    } catch {
      // Denied (battery saver, no user gesture yet): the screen may sleep.
    }
  };
  const onVisibility = () => void acquire();

  void acquire();
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    stopped = true;
    doc.removeEventListener('visibilitychange', onVisibility);
    void sentinel?.release();
  };
}

export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined') return;
    return keepScreenAwake(navigator as WakeLockNavigator, document);
  }, [enabled]);
}
