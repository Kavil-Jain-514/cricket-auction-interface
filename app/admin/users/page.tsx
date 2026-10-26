"use client";

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Search, ShieldCheck, User } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { getErrorMessage } from '@/lib/utils';

export default function AdminUsersPage() {
  const users = useQuery(api.auth.getAllUsers);
  const me = useQuery(api.auth.me);
  const setUserRole = useMutation(api.auth.setUserRole);
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users ?? [])
      .filter((u) => !q || u.email.toLowerCase().includes(q) || (u.name ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'admin' ? -1 : 1));
  }, [users, search]);
  const adminCount = (users ?? []).filter((u) => u.role === 'admin').length;

  const changeRole = async (user: { _id: Id<"users">; email: string; role: string }, role: 'admin' | 'user') => {
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
    if (!ok) return;
    setBusyId(user._id);
    try {
      await setUserRole({ userId: user._id, role });
      toast.success(role === 'admin' ? `${user.email} is now an admin` : `${user.email} is now a user`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not change the role'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          {users ? `${users.length} users · ${adminCount} admin${adminCount === 1 ? '' : 's'}` : 'Loading…'}
        </p>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email" className="pl-9" aria-label="Search users" />
        </div>
      </div>

      <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
        {filtered.map((u) => {
          const isSelf = u._id === me?._id;
          const lastAdmin = u.role === 'admin' && adminCount <= 1;
          return (
            <li key={u._id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {u.role === 'admin' ? <ShieldCheck className="w-5 h-5 shrink-0 text-blue-400" /> : <User className="w-5 h-5 shrink-0 text-slate-500" />}
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {u.name || u.email}
                    {isSelf && <span className="ml-2 text-xs text-slate-500">(you)</span>}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {u.email} · joined {new Date(u.createdAt).toLocaleDateString('en-IN')}
                  </div>
                </div>
              </div>
              <span className={`self-start sm:self-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${u.role === 'admin' ? 'bg-blue-500/15 text-blue-300' : 'bg-slate-800 text-slate-300'}`}>
                {u.role === 'admin' ? 'Admin' : 'User'}
              </span>
              {u.role === 'admin' ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === u._id || lastAdmin}
                  title={lastAdmin ? 'The last admin can’t be removed. Promote someone else first.' : undefined}
                  onClick={() => changeRole(u, 'user')}
                  className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
                >
                  {isSelf ? 'Step down' : 'Remove admin'}
                </Button>
              ) : (
                <Button size="sm" disabled={busyId === u._id} onClick={() => changeRole(u, 'admin')}>
                  Make admin
                </Button>
              )}
            </li>
          );
        })}
        {users && filtered.length === 0 && <li className="p-4 text-sm text-slate-500">No users match.</li>}
      </ul>
    </section>
  );
}
