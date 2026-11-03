"use client";

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const REDIRECT_AFTER_MS = 10_000;

/**
 * Shown when the room no longer exists (its tournament was deleted) or its
 * tournament was hidden. Every open screen gets this the moment it happens,
 * then goes home on its own.
 */
export function AuctionUnavailable({ homeHref }: { homeHref: string }) {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace(homeHref), REDIRECT_AFTER_MS);
    return () => clearTimeout(t);
  }, [homeHref, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 px-4 text-white">
      <div role="alert" className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold">This auction isn&apos;t available</h1>
        <p className="text-slate-400">The organiser has removed or hidden this tournament. Taking you back in a few seconds.</p>
        <Link href={homeHref} className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-5 font-semibold hover:bg-blue-500">
          Go now
        </Link>
      </div>
    </main>
  );
}
