"use client";

import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { Copy, Download, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import type { TeamOwnerStatus } from '@/convex/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toCsv } from '@/lib/csv';
import { cn } from '@/lib/utils';

type Row = { key: string; name?: string; email: string; detail?: string; badge?: { label: string; cls: string } };

const STATUS: Record<TeamOwnerStatus, { label: string; cls: string }> = {
  joined: { label: 'Joined', cls: 'bg-green-500/15 text-green-300' },
  requested: { label: 'Awaiting approval', cls: 'bg-amber-500/15 text-amber-300' },
  invited: { label: 'Pending', cls: 'bg-slate-500/20 text-slate-300' },
};

function matches(row: Row, search: string): boolean {
  return [row.name, row.email, row.detail].some((v) => v?.toLowerCase().includes(search));
}

function copyEmail(email: string) {
  navigator.clipboard.writeText(email).then(
    () => toast.success('Email copied'),
    () => toast.error('Could not copy the email'),
  );
}

/** Rows as a table from md up and stacked cards on phones. */
function PeopleList({ title, detailLabel, rows, empty }: { title: string; detailLabel: string; rows: Row[]; empty: string }) {
  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold text-slate-200">
        {title} <span className="font-normal text-slate-400">({rows.length})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-slate-700 p-3 text-center text-sm text-slate-400">{empty}</p>
      ) : (
        <>
          <table className="mt-2 hidden w-full text-left text-sm md:table">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr className="border-b border-slate-700">
                <th scope="col" className="py-2 pr-3 font-medium">Name</th>
                <th scope="col" className="py-2 pr-3 font-medium">Email</th>
                <th scope="col" className="py-2 pr-3 font-medium">{detailLabel}</th>
                <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                <th scope="col" className="py-2"><span className="sr-only">Copy</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-slate-800 last:border-0">
                  <td className="max-w-48 truncate py-1.5 pr-3 text-slate-100">{row.name ?? <span className="text-slate-500">—</span>}</td>
                  <td className="max-w-64 truncate py-1.5 pr-3 text-slate-300">{row.email}</td>
                  <td className="max-w-48 truncate py-1.5 pr-3 text-slate-300">{row.detail ?? <span className="text-slate-500">—</span>}</td>
                  <td className="py-1.5 pr-3">
                    {row.badge && <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', row.badge.cls)}>{row.badge.label}</span>}
                  </td>
                  <td className="py-1.5 text-right">
                    <CopyButton row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mt-2 space-y-2 md:hidden">
            {rows.map((row) => (
              <li key={row.key} className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-100">{row.name ?? row.email}</div>
                  {row.name && <div className="truncate text-sm text-slate-300">{row.email}</div>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    {row.detail && <span className="truncate">{row.detail}</span>}
                    {row.badge && <span className={cn('rounded-full px-2 py-0.5 font-semibold', row.badge.cls)}>{row.badge.label}</span>}
                  </div>
                </div>
                <CopyButton row={row} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CopyButton({ row }: { row: Row }) {
  return (
    <button
      type="button"
      onClick={() => copyEmail(row.email)}
      className="fl-focus inline-flex shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white touch-target"
      aria-label={`Copy email of ${row.name ?? row.email}`}
      title="Copy email"
    >
      <Copy className="h-4 w-4" aria-hidden />
    </button>
  );
}

/**
 * Super-admin only: the tournament's organisers and team owners with their
 * emails (auth:tournamentPeople refuses everyone else). Mounted only for
 * super-admins, so nobody else even subscribes.
 */
export function TournamentPeople({ tournamentId, tournamentName }: { tournamentId: Id<"tournaments">; tournamentName: string }) {
  const people = useQuery(api.auth.tournamentPeople, { tournamentId });
  const [search, setSearch] = useState('');

  const { organisers, owners } = useMemo(() => {
    if (!people) return { organisers: [], owners: [] };
    return {
      organisers: people.organisers.map((p): Row => ({
        key: p.userId,
        name: p.name,
        email: p.email,
        detail: p.role === 'owner' ? 'Organiser' : 'Auctioneer',
      })),
      owners: people.teamOwners.map((p): Row => ({ key: p.key, name: p.name, email: p.email, detail: p.teamName, badge: STATUS[p.status] })),
    };
  }, [people]);

  const needle = search.trim().toLowerCase();
  const shownOrganisers = needle ? organisers.filter((r) => matches(r, needle)) : organisers;
  const shownOwners = needle ? owners.filter((r) => matches(r, needle)) : owners;

  const exportCsv = () => {
    const csv = toCsv([
      ['Group', 'Name', 'Email', 'Team or role', 'Status'],
      ...organisers.map((r) => ['Organisers', r.name, r.email, r.detail, '']),
      ...owners.map((r) => ['Team owners', r.name, r.email, r.detail, r.badge?.label]),
    ]);
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${tournamentName.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'tournament'}-people.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="people-title" className="mb-6 sm:mb-8 rounded-xl border border-slate-700 bg-slate-800/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="people-title" className="flex items-center gap-2 text-lg font-bold">
            <Users className="h-5 w-5 text-blue-400" aria-hidden /> People
          </h2>
          <p className="text-sm text-slate-400">Super-admin only. Organisers and team owners with their emails.</p>
        </div>
        <Button type="button" variant="outline" onClick={exportCsv} disabled={!people} className="h-11 border-slate-600 bg-slate-800 px-4 text-sm text-slate-200 hover:bg-slate-700 hover:text-white">
          <Download className="mr-2 h-4 w-4" aria-hidden /> Export CSV
        </Button>
      </div>

      <div className="relative mt-4">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or team"
          aria-label="Search people"
          className="h-11 border-slate-600 bg-slate-900 pl-9 text-white"
        />
      </div>

      {people === undefined ? (
        <p className="mt-5 text-sm text-slate-400" role="status">Loading people…</p>
      ) : (
        <>
          <PeopleList title="Organisers" detailLabel="Role" rows={shownOrganisers} empty={needle ? 'No organisers match.' : 'No organisers yet.'} />
          <PeopleList title="Team owners" detailLabel="Team" rows={shownOwners} empty={needle ? 'No team owners match.' : 'No team owners yet.'} />
        </>
      )}
    </section>
  );
}
