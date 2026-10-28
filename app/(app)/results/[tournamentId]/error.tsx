'use client';

import Link from 'next/link';

/** A malformed id (or any load failure) reads the same as "not published". */
export default function ResultsError() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4">
      <div className="text-center space-y-3">
        <h1 className="text-2xl font-bold">Results not available</h1>
        <p className="text-slate-400">This tournament hasn&apos;t published its results.</p>
        <Link href="/" className="text-blue-400 hover:underline">Go to Bid11Pro</Link>
      </div>
    </main>
  );
}
