"use client";

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from 'convex/react';
import { CheckCircle2, Clock, ShieldCheck, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { ImgWithFallback } from '@/components/ui/img-with-fallback';
import { TeamRequestForm } from '@/components/teams/TeamRequestForm';
import { getErrorMessage } from '@/lib/utils';

const INTENT_LABEL = { organiser: 'an organiser', visitor: 'a viewer', team_owner: 'a team owner' } as const;

/**
 * Where "Invite team owners" links and emails point. A signed-in person
 * confirms they own a team (if they haven't said so yet), then registers it
 * for the organiser to verify (teamRequests:submit).
 */
export default function JoinTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tournamentId = id as Id<"tournaments">;
  const info = useQuery(api.tournaments.getJoinTeamInfo, { tournamentId });
  const me = useQuery(api.auth.me, {});
  const staffRole = useQuery(api.tournaments.myRole, me ? { tournamentId } : 'skip');
  const myRequest = useQuery(api.teamRequests.getMineForTournament, me?.accountType === 'team_owner' ? { tournamentId } : 'skip');
  const setAccountType = useMutation(api.auth.setAccountType);
  const [switching, setSwitching] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const becomeTeamOwner = async () => {
    setSwitching(true);
    try {
      await setAccountType({ accountType: 'team_owner' });
      setFormOpen(true);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not continue'));
    } finally {
      setSwitching(false);
    }
  };

  const card = (children: React.ReactNode) => (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Navbar />
      <main className="mx-auto max-w-lg px-4 py-8 sm:py-12">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
          {info && (
            <div className="mb-5 flex items-center gap-3">
              <ImgWithFallback
                src={info.logoUrl}
                alt=""
                className="h-14 w-14 shrink-0 rounded-xl border border-slate-700 object-contain"
                fallback={<div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-yellow-500/15"><Trophy className="h-7 w-7 text-yellow-500" aria-hidden /></div>}
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-blue-300">Team registration</p>
                <h1 className="truncate text-xl font-bold sm:text-2xl">{info.name}</h1>
              </div>
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );

  // The route needs sign-in, so `me` is only null for a moment after a first
  // sign-up, until the user row exists (auth:ensureUser).
  if (info === undefined || !me || staffRole === undefined) {
    return card(<div role="status" aria-label="Loading" className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-blue-500" />);
  }
  if (info === null) return card(<p className="text-slate-300">This tournament isn&apos;t available.</p>);
  if (!info.open) return card(<p className="text-slate-300">This tournament has finished, so teams can no longer be added.</p>);
  if (me.isDeactivated) return card(<p className="text-slate-300">Your account is deactivated. Contact Bid11Pro support if you think this is a mistake.</p>);

  if (staffRole) {
    return card(
      <div className="space-y-4">
        <p className="text-slate-300">You help run this tournament, so you don&apos;t register a team here. Send this page&apos;s link to team owners instead.</p>
        <Button asChild className="min-h-11 w-full">
          <Link href={`/tournament/${tournamentId}/teams`}>Go to Teams</Link>
        </Button>
      </div>,
    );
  }

  if (me.accountType !== 'team_owner') {
    return card(
      <div className="space-y-4">
        <p className="text-slate-300">
          {me.accountType
            ? `You're signed in as ${INTENT_LABEL[me.accountType]}. To register a team, continue as a team owner.`
            : 'Continue as a team owner to register your team.'}{' '}
          The organiser verifies it, and then you can bid for players from your phone during the auction.
        </p>
        {me.accountType === 'organiser' && (
          <p className="rounded-lg border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-sm text-amber-200">
            As a team owner this account can&apos;t create tournaments. Tournaments you already run aren&apos;t affected, and
            you can switch back from your dashboard.
          </p>
        )}
        <Button onClick={becomeTeamOwner} disabled={switching} className="min-h-11 w-full">
          <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />
          {switching ? 'One moment…' : 'Continue as team owner'}
        </Button>
      </div>,
    );
  }

  if (myRequest === undefined) {
    return card(<div role="status" aria-label="Loading" className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-blue-500" />);
  }

  if (myRequest && myRequest.status !== 'rejected') {
    const approved = myRequest.status === 'approved';
    return card(
      <div className="space-y-4 text-center">
        {approved ? <CheckCircle2 className="mx-auto h-12 w-12 text-green-400" aria-hidden /> : <Clock className="mx-auto h-12 w-12 text-amber-400" aria-hidden />}
        <h2 className="text-lg font-bold">{myRequest.name}: {approved ? 'verified' : 'waiting for the organiser'}</h2>
        <p className="text-sm text-slate-400">
          {approved ? "Your team is in. You'll bid from your phone when the auction starts." : "We'll show it here as soon as the organiser verifies your team."}
        </p>
        <Button asChild className="min-h-11 w-full">
          <Link href={`/tournament/${tournamentId}`}>Open the tournament</Link>
        </Button>
      </div>,
    );
  }

  return card(
    <div className="space-y-4">
      {myRequest?.status === 'rejected' && (
        <p className="rounded-lg border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-200">
          Your last request ({myRequest.name}) was rejected{myRequest.rejectReason ? `: ${myRequest.rejectReason}` : ''}. You can register again.
        </p>
      )}
      <p className="text-slate-300">Add your team&apos;s name, owner, colours and logo. The organiser verifies it before the auction.</p>
      <Button onClick={() => setFormOpen(true)} className="min-h-11 w-full">
        <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />
        Register your team
      </Button>
      {formOpen && (
        <TeamRequestForm tournamentId={tournamentId} tournamentName={info.name} defaultOwnerName={me.name} onClose={() => setFormOpen(false)} />
      )}
    </div>,
  );
}
