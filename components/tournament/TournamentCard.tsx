import Link from 'next/link';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';
import { formatRupees } from '@/convex/bidRules';
import { cn } from '@/lib/utils';

export type TournamentCardData = FunctionReturnType<typeof api.tournaments.listPublic>['page'][number] & {
  myRole?: 'owner' | 'auctioneer';
  teamName?: string;
};

const STATUS_CLS: Record<TournamentCardData['status'], string> = {
  active: 'bg-green-600',
  setup: 'bg-orange-600',
  completed: 'bg-red-600',
  draft: 'bg-slate-600',
};

function CricketBallMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <circle cx="50" cy="50" r="45" fill="#DC2626" />
      <path d="M20 50 Q35 30, 50 50 Q65 70, 80 50" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 50 Q35 70, 50 50 Q65 30, 80 50" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** A tournament on the dashboard. Live auctions get a pulsing LIVE badge. */
export function TournamentCard({ tournament }: { tournament: TournamentCardData }) {
  return (
    <Link
      href={`/tournament/${tournament._id}`}
      className="group block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
    >
      <article
        className={cn(
          'h-full rounded-xl border bg-slate-800/50 p-4 transition active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 sm:p-5 lg:p-6',
          tournament.isLive ? 'border-red-500/60 hover:border-red-400' : 'border-slate-700 hover:border-orange-500/50',
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {tournament.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tournament.logoUrl}
                alt=""
                loading="lazy"
                className="h-12 w-12 shrink-0 rounded-lg border border-slate-600 object-cover transition group-hover:border-orange-500/50 sm:h-14 sm:w-14"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-red-500/20 to-orange-500/20 sm:h-14 sm:w-14">
                <CricketBallMark className="h-6 w-6 sm:h-7 sm:w-7" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="mb-1 truncate text-base font-bold transition group-hover:text-orange-400 sm:text-lg">{tournament.name}</h3>
              {tournament.description && <p className="line-clamp-1 text-xs text-slate-400 sm:text-sm">{tournament.description}</p>}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {tournament.isLive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold tracking-wide text-white">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white motion-reduce:animate-none" aria-hidden />
                LIVE
              </span>
            ) : (
              <span className={cn('whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold sm:px-3', STATUS_CLS[tournament.status])}>
                {tournament.status}
              </span>
            )}
            {tournament.isActive === false && (
              <span className="whitespace-nowrap rounded-full border border-amber-600/40 bg-amber-600/20 px-2.5 py-1 text-xs font-semibold text-amber-400 sm:px-3">
                Inactive
              </span>
            )}
          </div>
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between text-slate-400">
            <dt>Base purse</dt>
            <dd className="font-semibold text-green-400">{formatRupees(tournament.basePurse)}</dd>
          </div>
          <div className="flex justify-between text-slate-400">
            <dt>Max players</dt>
            <dd className="font-semibold text-slate-200">{tournament.maxPlayersPerTeam}</dd>
          </div>
          {tournament.teamName && (
            <div className="flex justify-between text-slate-400">
              <dt>Your team</dt>
              <dd className="truncate pl-2 font-semibold text-blue-300">{tournament.teamName}</dd>
            </div>
          )}
        </dl>

        <div className="mt-4 flex items-center justify-between border-t border-slate-700 pt-4 text-xs text-slate-400">
          <span>{tournament.myRole ? (tournament.myRole === 'owner' ? 'You own this' : 'You are an auctioneer') : `Created ${new Date(tournament.createdAt).toLocaleDateString('en-IN')}`}</span>
          <span className="font-medium text-orange-400 group-hover:underline">{tournament.isLive ? 'Watch live →' : 'View details →'}</span>
        </div>
      </article>
    </Link>
  );
}
