'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { getErrorMessage } from '@/lib/utils';

/** Last-resort error screen for any app page without its own error.tsx. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Page error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
      <div role="alert" className="text-center space-y-6 max-w-md px-6">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-white">Something went wrong</h2>
          <p className="text-sm text-slate-400">{getErrorMessage(error, 'This page couldn’t load')}</p>
        </div>
        <div className="flex justify-center gap-3">
          <button
            onClick={reset}
            className="min-h-11 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center px-6 py-2.5 border border-slate-600 text-slate-200 hover:bg-slate-800 text-sm font-medium rounded-lg transition-colors"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
