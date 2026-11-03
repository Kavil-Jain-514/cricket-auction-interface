"use client";

import { useRef, type KeyboardEvent } from 'react';
import { usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Skeleton } from '@/components/ds/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TournamentCard, type TournamentCardData } from './TournamentCard';

const PAGE_SIZE = 12;

export type StatusFilter = 'all' | 'live' | 'upcoming' | 'completed' | 'inactive';

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  live: 'Live',
  upcoming: 'Upcoming',
  completed: 'Completed',
  inactive: 'Inactive',
};

/**
 * Tabs (WAI-ARIA tablist): arrow keys, Home and End move between them.
 * The panel each tab controls is `${id}-panel`.
 */
export function SegmentedTabs<K extends string>({
  id,
  label,
  tabs,
  value,
  onChange,
}: {
  id: string;
  label: string;
  tabs: Array<{ key: K; label: string }>;
  value: K;
  onChange: (key: K) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-700 bg-slate-900/70 p-1">
      {tabs.map((tab, i) => {
        const selected = tab.key === value;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${id}-tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${id}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'min-h-11 shrink-0 rounded-lg px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 motion-reduce:transition-none',
              selected ? 'bg-linear-to-r from-red-600 to-orange-500 text-white shadow' : 'text-slate-400 hover:text-white',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function GridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 lg:gap-6" aria-busy="true" aria-label="Loading tournaments">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-52 rounded-xl" />
      ))}
    </div>
  );
}

function Grid({ items }: { items: TournamentCardData[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 lg:gap-6">
      {items.map((t) => (
        <li key={t._id}>
          <TournamentCard tournament={t} />
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-700 px-4 py-12 text-center sm:py-16">
      <h3 className="mb-2 text-lg font-semibold sm:text-xl">{title}</h3>
      <p className="mx-auto mb-6 max-w-md text-sm text-slate-400 sm:text-base">{body}</p>
      {action}
    </div>
  );
}

/** A server-paginated grid with loading, empty and "load more" states. */
function PagedView({
  page,
  empty,
}: {
  page: { results: TournamentCardData[]; status: ReturnType<typeof usePaginatedQuery>['status']; loadMore: (n: number) => void };
  empty: React.ReactNode;
}) {
  const { results, status, loadMore } = page;
  if (status === 'LoadingFirstPage') return <GridSkeleton />;
  if (results.length === 0) return <>{empty}</>;
  return (
    <div className="space-y-6">
      <Grid items={results} />
      {status !== 'Exhausted' && (
        <div className="flex justify-center">
          <Button variant="outline" className="min-h-11" disabled={status === 'LoadingMore'} onClick={() => loadMore(PAGE_SIZE)}>
            {status === 'LoadingMore' ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}

type Status = Exclude<StatusFilter, 'all'> | undefined;

function PublicPage({ status, empty }: { status: Exclude<Status, 'inactive'>; empty: React.ReactNode }) {
  const page = usePaginatedQuery(api.tournaments.listPublic, { status }, { initialNumItems: PAGE_SIZE });
  return <PagedView page={page} empty={empty} />;
}

function AdminPage({ status, empty }: { status: Status; empty: React.ReactNode }) {
  const page = usePaginatedQuery(api.tournaments.listForAdmin, { status }, { initialNumItems: PAGE_SIZE });
  return <PagedView page={page} empty={empty} />;
}

const EMPTY_COPY: Record<StatusFilter, { title: string; body: string }> = {
  all: { title: 'No tournaments yet', body: 'Public tournaments appear here as organisers create them.' },
  live: { title: 'Nothing live right now', body: 'Auctions show up here the moment they start.' },
  upcoming: { title: 'No upcoming tournaments', body: 'Check back soon, or look at completed ones.' },
  completed: { title: 'No completed tournaments yet', body: 'Finished auctions and their results appear here.' },
  inactive: { title: 'No deactivated tournaments', body: 'Tournaments hidden by their organiser appear here.' },
};

/**
 * Public tournaments by status, live ones first. "All" pins the running
 * auctions above the rest; the server leaves them out of the other pages.
 * `admin` adds deactivated tournaments and the Inactive filter.
 */
export function StatusBrowser({
  filter,
  onFilterChange,
  admin = false,
}: {
  filter: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
  admin?: boolean;
}) {
  const filters: StatusFilter[] = admin ? ['all', 'live', 'upcoming', 'completed', 'inactive'] : ['all', 'live', 'upcoming', 'completed'];
  const status = filter === 'all' ? undefined : filter;
  const liveArgs = filter === 'all' ? { status: 'live' as const, paginationOpts: { numItems: 50, cursor: null } } : 'skip';
  const livePublic = useQuery(api.tournaments.listPublic, admin ? 'skip' : liveArgs);
  const liveAdmin = useQuery(api.tournaments.listForAdmin, admin ? liveArgs : 'skip');
  const live = admin ? liveAdmin : livePublic;
  const empty = filter === 'all' && live && live.page.length > 0 ? null : <EmptyState {...EMPTY_COPY[filter]} />;

  return (
    <div className="space-y-5">
      <SegmentedTabs
        id="status"
        label="Filter by status"
        tabs={filters.map((key) => ({ key, label: FILTER_LABELS[key] }))}
        value={filter}
        onChange={onFilterChange}
      />
      <div id="status-panel" role="tabpanel" aria-labelledby={`status-tab-${filter}`} className="space-y-8">
        {filter === 'all' && live && live.page.length > 0 && (
          <section aria-labelledby="live-now">
            <h3 id="live-now" className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-red-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none" aria-hidden /> Live now
            </h3>
            <Grid items={live.page} />
          </section>
        )}
        {admin ? (
          <AdminPage key={filter} status={status} empty={empty} />
        ) : (
          <PublicPage key={filter} status={status === 'inactive' ? undefined : status} empty={empty} />
        )}
      </div>
    </div>
  );
}

/**
 * Tournaments the user is on the staff of, paged. With `title`, renders as a
 * titled section only when there are any (staff who chose another intent).
 */
export function MyTournaments({ empty, title }: { empty: React.ReactNode; title?: string }) {
  const page = usePaginatedQuery(api.tournaments.listMinePaged, {}, { initialNumItems: PAGE_SIZE });
  if (!title) return <PagedView page={page} empty={empty} />;
  if (page.results.length === 0) return null;
  return (
    <section aria-labelledby="staff-of" className="space-y-4">
      <h2 id="staff-of" className="text-xl font-bold sm:text-2xl">{title}</h2>
      <PagedView page={page} empty={null} />
    </section>
  );
}

/** A team owner's tournaments: where they own a team or asked for one. */
export function TeamOwnerTournaments({ empty }: { empty: React.ReactNode }) {
  const rows = useQuery(api.tournaments.listForTeamOwner, {});
  if (rows === undefined) return <GridSkeleton count={2} />;
  if (rows.length === 0) return <>{empty}</>;
  return <Grid items={rows} />;
}
