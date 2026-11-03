"use client";

import { Fragment, useMemo, useState } from 'react';
import { usePaginatedQuery, useQuery } from 'convex/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { diffFields } from '@/lib/jsonDiff';

const PAGE_SIZE = 25;

// Every action logAdminAction is called with (grep `action: "` in convex/).
const ACTIONS = [
  'accept_bid_request', 'activate_tournament', 'approve_registration', 'add_tournament_staff', 'adjust_team_purse', 'bulk_import_players', 'clear_player_bids',
  'continue_stalled_unsold_round', 'create_owner_invite', 'create_player', 'create_team', 'deactivate_tournament',
  'delete_all_players', 'delete_player', 'delete_team', 'delete_tournament', 'grant_plan', 'lock_group_draw', 'pause_auction',
  'plan_payment', 'player_final_unsold', 'reassign_player', 'recalculate_team_purse', 'reject_bid_request', 'reject_registration', 'remove_team_member',
  'remove_tournament_staff', 'reset_group_draw', 'restart_auction', 'restart_current_player', 'resume_auction', 'revert_last_bid',
  'revoke_owner_invite', 'run_group_draw', 'set_user_role', 'start_next_player', 'update_player',
  'update_player_status', 'update_sold_price', 'update_team', 'update_tournament',
];

const label = (action: string) => action.replace(/_/g, ' ');

/** yyyy-mm-dd from an <input type="date"> → local start / end of that day. */
function dayBoundary(value: string, end: boolean): number | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  if (end) d.setHours(23, 59, 59, 999);
  return d.getTime();
}

const selectCls = 'mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-800 px-2 text-sm text-white';

export default function AdminAuditPage() {
  const [tournamentId, setTournamentId] = useState('');
  const [action, setAction] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const tournaments = useQuery(api.tournaments.listAll, {});
  const tournamentName = useMemo(
    () => new Map((tournaments ?? []).map((t) => [t._id as string, t.name])),
    [tournaments],
  );

  const { results, status, loadMore } = usePaginatedQuery(
    api.auth.listAuditLogs,
    {
      tournamentId: tournamentId ? (tournamentId as Id<"tournaments">) : undefined,
      action: action || undefined,
      from: dayBoundary(fromDay, false),
      to: dayBoundary(toDay, true),
    },
    { initialNumItems: PAGE_SIZE },
  );

  const clear = () => {
    setTournamentId('');
    setAction('');
    setFromDay('');
    setToDay('');
  };

  return (
    <section className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_10rem_10rem_auto] lg:items-end">
        <div>
          <Label htmlFor="audit-tournament" className="text-xs">Tournament</Label>
          <NativeSelect id="audit-tournament" value={tournamentId} onChange={(e) => setTournamentId(e.target.value)} className="mt-1 h-9">
            <option value="">All tournaments</option>
            {(tournaments ?? []).map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="audit-action" className="text-xs">Action</Label>
          <NativeSelect id="audit-action" value={action} onChange={(e) => setAction(e.target.value)} className="mt-1 h-9">
            <option value="">All actions</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{label(a)}</option>)}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="audit-from" className="text-xs">From</Label>
          <input id="audit-from" type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} className={selectCls} />
        </div>
        <div>
          <Label htmlFor="audit-to" className="text-xs">To</Label>
          <input id="audit-to" type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} className={selectCls} />
        </div>
        <Button variant="outline" onClick={clear} className="h-9 border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">
          Clear
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="w-8 px-3 py-2" aria-label="Expand" />
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2">Tournament</th>
              <th className="px-3 py-2">Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {results.map((log) => {
              const open = expanded === log._id;
              const rows = open ? diffFields(log.previousData, log.newData) : [];
              return (
                <Fragment key={log._id}>
                  <tr className="cursor-pointer hover:bg-slate-900/60" onClick={() => setExpanded(open ? null : log._id)}>
                    <td className="px-3 py-2 text-slate-500">
                      <button type="button" aria-expanded={open} aria-label={open ? 'Hide changes' : 'Show changes'}>
                        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-300">
                      {new Date(log.timestamp).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td className="px-3 py-2 font-medium capitalize">{label(log.action)}</td>
                    <td className="max-w-48 truncate px-3 py-2 text-slate-300">{log.userEmail}</td>
                    <td className="max-w-48 truncate px-3 py-2 text-slate-300">
                      {log.tournamentId ? (tournamentName.get(log.tournamentId) ?? '—') : '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-400">{log.targetType}</td>
                  </tr>
                  {open && (
                    <tr className="bg-slate-900/40">
                      <td />
                      <td colSpan={5} className="px-3 py-3">
                        {rows.length === 0 ? (
                          <p className="text-xs text-slate-500">No before/after data recorded.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead className="text-slate-500">
                              <tr>
                                <th className="py-1 pr-4 font-medium">Field</th>
                                <th className="py-1 pr-4 font-medium">Before</th>
                                <th className="py-1 font-medium">After</th>
                              </tr>
                            </thead>
                            <tbody className="font-mono">
                              {rows.map((r) => (
                                <tr key={r.key} className={r.changed ? 'text-white' : 'text-slate-500'}>
                                  <td className="py-1 pr-4 align-top">{r.key}{r.changed && <span className="ml-1 text-amber-400" aria-label="changed">•</span>}</td>
                                  <td className="py-1 pr-4 align-top break-all">{r.before ?? '—'}</td>
                                  <td className="py-1 align-top break-all">{r.after ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {status !== 'LoadingFirstPage' && results.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No log entries match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-center">
        {status === 'CanLoadMore' && (
          <Button variant="outline" onClick={() => loadMore(PAGE_SIZE)} className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">
            Load more
          </Button>
        )}
        {(status === 'LoadingFirstPage' || status === 'LoadingMore') && <p className="text-sm text-slate-500">Loading…</p>}
      </div>
    </section>
  );
}
