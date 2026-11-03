'use client';

import { useEffect } from 'react';

export default function TournamentError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Tournament error:', error);
    }, [error]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
            <div className="text-center space-y-6 max-w-md px-6">
                <div className="w-16 h-16 mx-auto rounded-full bg-red-500/20 flex items-center justify-center">
                    <span className="text-3xl">⚠️</span>
                </div>
                <div className="space-y-2">
                    <h2 className="text-xl font-semibold text-white">Something went wrong</h2>
                    <p className="text-sm text-slate-400">
                        {error.message || 'An unexpected error occurred loading the tournament.'}
                    </p>
                </div>
                <button
                    onClick={reset}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
                >
                    Try Again
                </button>
            </div>
        </div>
    );
}
