// app/join/[token]/page.tsx
"use client";

import { use, useEffect, useRef, useState } from 'react';
import { useConvexAuth, useMutation } from 'convex/react';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/utils';

interface JoinPageProps {
  params: Promise<{ token: string }>;
}

type ClaimState =
  | { status: 'claiming' }
  | { status: 'joined'; teamName: string; tournamentId: string; auctionRoomId: string | null }
  | { status: 'failed'; reason: string };

/**
 * Owner invite landing page. The route is sign-in protected (proxy.ts), so by
 * the time Convex auth is ready the visitor is signed in; claimInvite then
 * links them to the team as an owner.
 */
export default function JoinPage({ params }: JoinPageProps) {
  const { token } = use(params);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const claimInvite = useMutation(api.members.claimInvite);
  const [state, setState] = useState<ClaimState>({ status: 'claiming' });
  const claimed = useRef(false);

  useEffect(() => {
    if (isLoading || !isAuthenticated || claimed.current) return;
    claimed.current = true;
    claimInvite({ token })
      .then((res) =>
        setState(
          res.success
            ? { status: 'joined', teamName: res.teamName, tournamentId: res.tournamentId, auctionRoomId: res.auctionRoomId }
            : { status: 'failed', reason: res.reason },
        ),
      )
      .catch((error) =>
        setState({ status: 'failed', reason: getErrorMessage(error, 'Could not join the team') }),
      );
  }, [isLoading, isAuthenticated, claimInvite, token]);

  return (
    <div className="min-h-[100dvh] bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-6 text-center">
        {state.status === 'claiming' && (
          <>
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-blue-500/30 border-t-blue-500" />
            <p className="text-slate-300">Joining your team…</p>
          </>
        )}

        {state.status === 'joined' && (
          <>
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-green-400" />
            <h1 className="text-2xl font-bold mb-1">You&apos;re in</h1>
            <p className="text-slate-300 mb-6">
              You can now bid for <span className="font-semibold text-white">{state.teamName}</span> from this phone.
            </p>
            <Button asChild className="w-full h-12 text-base bg-blue-600 hover:bg-blue-700 text-white">
              <Link href={state.auctionRoomId ? `/auction/${state.auctionRoomId}` : `/tournament/${state.tournamentId}`}>
                {state.auctionRoomId ? 'Go to the auction' : 'View the tournament'}
              </Link>
            </Button>
          </>
        )}

        {state.status === 'failed' && (
          <>
            <XCircle className="mx-auto mb-3 h-12 w-12 text-red-400" />
            <h1 className="text-xl font-bold mb-1">Could not join</h1>
            <p className="text-slate-300 mb-6">{state.reason}</p>
            <p className="text-xs text-slate-500">Ask the organiser for a new invite link.</p>
          </>
        )}
      </div>
    </div>
  );
}
