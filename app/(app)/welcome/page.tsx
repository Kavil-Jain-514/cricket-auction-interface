"use client";

import { Suspense, useEffect } from 'react';
import { useQuery } from 'convex/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/convex/_generated/api';
import { AccountTypePrompt } from '@/components/onboarding/AccountTypePrompt';
import { safeNextPath } from '@/lib/navigation';

/**
 * The signup-intent step. Email and social sign-ups both land on the
 * dashboard, which sends anyone who hasn't chosen here; `next` brings them
 * back to where they were going.
 */
function Welcome() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));
  const me = useQuery(api.auth.me, {});
  const done = me !== undefined && me !== null && (me.isAdmin || me.accountType !== undefined);

  useEffect(() => {
    if (done) router.replace(next);
  }, [done, next, router]);

  return (
    <main className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950">
      {me && !done && <AccountTypePrompt onChosen={() => router.replace(next)} />}
    </main>
  );
}

export default function WelcomePage() {
  return (
    <Suspense>
      <Welcome />
    </Suspense>
  );
}
