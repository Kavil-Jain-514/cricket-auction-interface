'use client';

import { useEffect } from 'react';

const RETRY_MS = 5000;

/**
 * A stream overlay must never put an error card on air. Stay transparent and
 * retry quietly until the room comes back.
 */
export default function OverlayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Overlay error:', error);
    const retry = setTimeout(reset, RETRY_MS);
    return () => clearTimeout(retry);
  }, [error, reset]);

  return null;
}
