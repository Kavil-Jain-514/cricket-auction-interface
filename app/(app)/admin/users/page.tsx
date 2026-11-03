"use client";

import { useEffect, useState } from 'react';
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { Search, ShieldCheck, User, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { SegmentedTabs } from '@/components/tournament/TournamentBrowser';
import { getErrorMessage } from '@/lib/utils';

type Filter = 'all' | 'organiser' | 'team_owner' | 'visitor' | 'none' | 'admin' | 'deactivated';
type Intent = 'organiser' | 'team_owner' | 'visitor';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'organiser', label: 'Organisers' },
  { key: 'team_owner', label: 'Team owners' },
  { key: 'visitor', label: 'Viewers' },
  { key: 'none', label: 'Not chosen' },
  { key: 'admin', label: 'Admins' },
  { key: 'deactivated', label: 'Deactivated' },
];
const INTENT_LABEL: Record<Intent, string> = { organiser: 'Organiser', team_owner: 'Team owner', visitor: 'Viewer' };
const PAGE_SIZE = 25;

/** Super-admin: find users, change their role or intent, deactivate them. Filtered and paged on the server. */
export default function AdminUsersPage() {
  const me = useQuery(api.auth.me);
  const setUserRole = useMutation(api.auth.setUserRole);
  const setUserIntent = useMutation(api.auth.setUserIntent);
  const setUserActive = useMutation(api.auth.setUserActive);
  const confirm = useConfirm();
  const [filter, setFilter] = useState<Filter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // One query per pause in typing, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { results: users, status, loadMore } = usePaginatedQuery(
    api.auth.listUsers,
    { filter: filter === 'all' ? undefined : filter, search: search || undefined },
    { initialNumItems: PAGE_SIZE },
  );

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusyId(id);
    try {
      await fn();
      toast.success(ok);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Something went wrong'));
    } finally {
      setBusyId(null);
    }
  };

  const changeRole = async (user: { _id: Id<"users">; email: string }, role: 'admin' | 'user') => {
    const isSelf = user._id === me?._id;
    const ok = await confirm(
      role === 'admin'
        ? { title: `Make ${user.email} an admin?`, description: 'Admins can change every tournament, purse and user.', confirmText: 'Make admin' }
        : {
            title: isSelf ? 'Step down as admin?' : `Remove admin from ${user.email}?`,
            description: isSelf ? "You'll lose access to the back office straight away." : 'They keep their account as a regular user.',
            confirmText: 'Remove admin',
            variant: 'danger',
          },
    );
    if (ok) await act(user._id, () => setUserRole({ userId: user._id, role }), role === 'admin' ? `${user.email} is now an admin` : `${user.email} is now a user`);
  };

  const toggleActive = async (user: { _id: Id<"users">; email: string; deactivated: boolean }) => {
    if (!user.deactivated) {
      const ok = await confirm({
        title: `Deactivate ${user.email}?`,
        description: 'They are signed out of everything in Bid11Pro straight away: no tournaments, bidding or registrations. Their data stays, and you can reactivate them at any time.',
        confirmText: 'Deactivate',
        variant: 'danger',
      });
      if (!ok) return;
    }
    await act(user._id, () => setUserActive({ userId: user._id, active: user.deactivated }), user.deactivated ? `${user.email} reactivated` : `${user.email} deactivated`);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedTabs id="user-filter" label="Filter users" tabs={FILTERS} value={filter} onChange={setFilter} />
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Email starts with…"
            className="h-11 pl-9"
            aria-label="Search users by email"
            inputMode="email"
          />
        </div>
      </div>

      <ul id="user-filter-panel" role="tabpanel" aria-labelledby={`user-filter-tab-${filter}`} aria-busy={status === 'LoadingFirstPage'} className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
        {users.map((u) => {
          const isSelf = u._id === me?._id;
          const isAdmin = u.role === 'admin';
          return (
            <li key={u._id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {u.deactivated ? (
                  <UserX className="h-5 w-5 shrink-0 text-red-400" aria-hidden />
                ) : isAdmin ? (
                  <ShieldCheck className="h-5 w-5 shrink-0 text-blue-400" aria-hidden />
                ) : (
                  <User className="h-5 w-5 shrink-0 text-slate-500" aria-hidden />
                )}
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {u.name || u.email}
                    {isSelf && <span className="ml-2 text-xs text-slate-500">(you)</span>}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {u.email} · joined {new Date(u.createdAt).toLocaleDateString('en-IN')}
                    {u.tournaments > 0 && ` · on ${u.tournaments} tournament${u.tournaments === 1 ? '' : 's'}`}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isAdmin && <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-semibold text-blue-300">Admin</span>}
                {u.deactivated && <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-semibold text-red-300">Deactivated</span>}
                {!isAdmin && (
                  <NativeSelect
                    aria-label={`Intent for ${u.email}`}
                    value={u.intent ?? ''}
                    disabled={busyId === u._id}
                    onChange={(e) => {
                      const next = e.target.value as Intent;
                      if (next) act(u._id, () => setUserIntent({ userId: u._id, accountType: next }), `${u.email} is now a ${INTENT_LABEL[next].toLowerCase()}`);
                    }}
                    className="h-11 w-40"
                  >
                    <option value="" disabled>Not chosen</option>
                    {(Object.keys(INTENT_LABEL) as Intent[]).map((k) => <option key={k} value={k}>{INTENT_LABEL[k]}</option>)}
                  </NativeSelect>
                )}
                {isAdmin ? (
                  <Button size="sm" variant="outline" disabled={busyId === u._id} onClick={() => changeRole(u, 'user')} className="min-h-11 border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">
                    {isSelf ? 'Step down' : 'Remove admin'}
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="outline" disabled={busyId === u._id || u.deactivated} onClick={() => changeRole(u, 'admin')} className="min-h-11 border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">
                      Make admin
                    </Button>
                    <Button size="sm" variant="outline" disabled={busyId === u._id} onClick={() => toggleActive(u)} className={`min-h-11 ${u.deactivated ? 'border-green-700 bg-green-900/30 text-green-300 hover:bg-green-800/50' : 'border-red-800 bg-red-950/40 text-red-300 hover:bg-red-900/50'} hover:text-white`}>
                      {u.deactivated ? 'Reactivate' : 'Deactivate'}
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
        {status === 'LoadingFirstPage' && <li className="p-4 text-sm text-slate-500">Loading…</li>}
        {status !== 'LoadingFirstPage' && users.length === 0 && <li className="p-4 text-sm text-slate-500">No users match.</li>}
      </ul>

      {(status === 'CanLoadMore' || status === 'LoadingMore') && (
        <div className="flex justify-center">
          <Button variant="outline" className="min-h-11" disabled={status === 'LoadingMore'} onClick={() => loadMore(PAGE_SIZE)}>
            {status === 'LoadingMore' ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </section>
  );
}
