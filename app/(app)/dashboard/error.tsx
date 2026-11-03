'use client';

import { useEffect } from 'react';

export default function DashboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Dashboard error:', error);
    }, [error]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
            <div role="alert" className="text-center space-y-6 max-w-md px-6">
                <div className="space-y-2">
                    <h2 className="text-xl font-semibold text-white">Couldn&apos;t load your tournaments</h2>
                    <p className="text-sm text-slate-400">Check your connection and try again.</p>
                </div>
                <button
                    onClick={reset}
                    className="min-h-11 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
                >
                    Try Again
                </button>
            </div>
        </div>
    );
}
