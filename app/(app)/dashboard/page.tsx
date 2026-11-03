"use client";

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useUser } from '@clerk/nextjs';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { AccountTypePrompt } from '@/components/onboarding/AccountTypePrompt';
import { TeamOwnerPanel } from '@/components/teams/TeamOwnerPanel';
import {
  EmptyState,
  MyTournaments,
  SegmentedTabs,
  StatusBrowser,
  TeamOwnerTournaments,
  type StatusFilter,
} from '@/components/tournament/TournamentBrowser';
import { useIntentGate } from '@/hooks/useIntentGate';
import { useStoredChoice } from '@/hooks/useStoredChoice';

const ORGANISER_TABS = ['mine', 'all'] as const;
const STATUS_FILTERS = ['all', 'live', 'upcoming', 'completed', 'inactive'] as const;

const SUBTITLE = {
  admin: 'Every tournament on Bid11Pro',
  organiser: 'Manage your cricket auction tournaments',
  team_owner: 'Your teams and the tournaments they play in',
  visitor: 'Follow cricket auction tournaments',
} as const;

function NewTournamentButton({ label = 'New Tournament' }: { label?: string }) {
  return (
    <Button asChild size="lg" className="h-12 w-full bg-linear-to-r from-red-600 to-orange-500 px-5 text-base hover:from-red-700 hover:to-orange-600 sm:w-auto sm:px-6">
      <Link href="/tournament/create">
        <Plus className="mr-2 h-5 w-5" />
        {label}
      </Link>
    </Button>
  );
}

/**
 * One dashboard per role: organisers get My / All tabs, viewers browse by
 * status (live first), team owners see only their tournaments, and the
 * super-admin sees everything. Every list is filtered and paged on the server.
 */
export default function DashboardPage() {
  const { isSignedIn, isLoaded } = useUser();
  // Anyone who hasn't chosen organiser / team owner / viewer goes to /welcome.
  const { me, needsIntent } = useIntentGate('/dashboard');
  const [changingType, setChangingType] = useState(false);
  const [tab, setTab] = useStoredChoice('bid11pro.dashboard.tab', 'mine', ORGANISER_TABS);
  const [filter, setFilter] = useStoredChoice<StatusFilter>('bid11pro.dashboard.filter', 'all', STATUS_FILTERS);

  if (isLoaded && !isSignedIn) {
    redirect('/sign-in');
  }

  if (!isLoaded || !me || needsIntent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-slate-950 via-slate-900 to-slate-950">
        <div role="status" aria-label="Loading" className="h-12 w-12 animate-spin rounded-full border-b-2 border-red-500" />
      </div>
    );
  }

  const view = me.isAdmin ? 'admin' : (me.accountType ?? 'visitor');
  // The admin's Inactive filter means nothing to anyone else.
  const publicFilter = filter === 'inactive' ? 'all' : filter;

  return (
    <div className="relative min-h-screen overflow-hidden bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-linear-to-t from-green-900/15 to-transparent" />
        <div className="absolute left-1/4 top-0 h-96 w-96 rounded-full bg-yellow-500/5 blur-3xl" />
        <div className="absolute right-1/4 top-0 h-96 w-96 rounded-full bg-orange-500/5 blur-3xl" />
      </div>

      <Navbar />

      <main className="safe-bottom relative z-10 mx-auto max-w-7xl space-y-6 px-4 py-6 sm:space-y-8 sm:px-6 sm:py-8 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="mb-2 text-2xl font-bold sm:text-3xl lg:text-4xl">
              <span className="bg-linear-to-r from-red-500 via-orange-400 to-yellow-500 bg-clip-text text-transparent">Dashboard</span>
            </h1>
            <p className="text-sm text-slate-400 sm:text-base">
              {SUBTITLE[view]}
              {!me.isAdmin && (
                <button type="button" onClick={() => setChangingType(true)} className="ml-2 rounded text-orange-400 hover:underline focus-visible:outline-2 focus-visible:outline-orange-400">
                  Change
                </button>
              )}
            </p>
          </div>
          {me.canCreateTournament && <NewTournamentButton />}
        </div>

        {view === 'organiser' && (
          <section className="space-y-5">
            <SegmentedTabs
              id="scope"
              label="Tournaments"
              tabs={[
                { key: 'mine', label: 'My Tournaments' },
                { key: 'all', label: 'All Tournaments' },
              ]}
              value={tab}
              onChange={setTab}
            />
            <div id="scope-panel" role="tabpanel" aria-labelledby={`scope-tab-${tab}`}>
              {tab === 'mine' ? (
                <MyTournaments
                  empty={
                    <EmptyState
                      title="No tournaments yet"
                      body="Create your first tournament and run an IPL-style auction."
                      action={<NewTournamentButton label="Create Tournament" />}
                    />
                  }
                />
              ) : (
                <StatusBrowser filter={publicFilter} onFilterChange={setFilter} />
              )}
            </div>
          </section>
        )}

        {view === 'admin' && <StatusBrowser admin filter={filter} onFilterChange={setFilter} />}

        {view === 'team_owner' && (
          <>
            <TeamOwnerPanel />
            <section aria-labelledby="my-tournaments" className="space-y-4">
              <h2 id="my-tournaments" className="text-xl font-bold sm:text-2xl">My tournaments</h2>
              <TeamOwnerTournaments
                empty={
                  <EmptyState
                    title="You haven't been invited yet"
                    body="Open the invite link or tournament link your organiser sent you and register your team there. It shows up here once you do."
                  />
                }
              />
            </section>
          </>
        )}

        {view === 'visitor' && <StatusBrowser filter={publicFilter} onFilterChange={setFilter} />}

        {/* Staff who chose viewer or team owner keep their tournaments. */}
        {(view === 'visitor' || view === 'team_owner') && <MyTournaments title="Tournaments you help run" empty={null} />}
      </main>

      {changingType && <AccountTypePrompt current={me.accountType} onClose={() => setChangingType(false)} />}
    </div>
  );
}
