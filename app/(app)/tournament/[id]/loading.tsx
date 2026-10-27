'use client';

export default function TournamentLoading() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
            <div className="text-center space-y-6">
                <div className="relative">
                    <div className="w-16 h-16 border-4 border-emerald-500/30 rounded-full animate-spin border-t-emerald-500 mx-auto" />
                </div>
                <div className="space-y-2">
                    <h2 className="text-xl font-semibold text-white">Loading Tournament</h2>
                    <p className="text-sm text-slate-400">Fetching tournament details...</p>
                </div>
            </div>
        </div>
    );
}
