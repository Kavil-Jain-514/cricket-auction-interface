"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { getErrorMessage } from '@/lib/utils';

type StaffRole = 'owner' | 'auctioneer';

const ROLE_HINT: Record<StaffRole, string> = {
  owner: 'Everything: settings, teams, players, staff, exports and the auction.',
  auctioneer: 'Runs the auction: bids, sales, corrections and purse tools. No settings, teams, players or staff.',
};

/** Owners add or remove the people who can run this tournament. */
export function StaffManager({ tournamentId }: { tournamentId: Id<"tournaments"> }) {
  const staff = useQuery(api.staff.list, { tournamentId });
  const addStaff = useMutation(api.staff.add);
  const removeStaff = useMutation(api.staff.remove);
  const confirm = useConfirm();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('auctioneer');
  const [busy, setBusy] = useState(false);

  const ownerCount = (staff ?? []).filter((s) => s.role === 'owner').length;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      await addStaff({ tournamentId, email, role });
      toast.success(`${email.trim()} added as ${role}`);
      setEmail('');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not add them'));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (member: { _id: Id<"tournamentStaff">; email: string; isMe: boolean }) => {
    const ok = await confirm({
      title: member.isMe ? 'Leave this tournament?' : `Remove ${member.email}?`,
      description: member.isMe ? "You'll lose access to it straight away." : 'They lose access to this tournament.',
      confirmText: member.isMe ? 'Leave' : 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await removeStaff({ staffId: member._id });
      toast.success(member.isMe ? 'You left the tournament' : `${member.email} removed`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not remove them'));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-slate-300">Staff</h3>
        <p className="text-xs text-slate-400 mt-1">People who can run this tournament. They need to have signed in to Bid11Pro once.</p>
      </div>

      <ul className="divide-y divide-slate-800 rounded-lg border border-slate-700">
        {(staff ?? []).map((s) => {
          const lastOwner = s.role === 'owner' && ownerCount <= 1;
          return (
            <li key={s._id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {s.name || s.email}
                  {s.isMe && <span className="ml-2 text-xs text-slate-500">(you)</span>}
                </div>
                <div className="truncate text-xs text-slate-400">{s.email}</div>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${s.role === 'owner' ? 'bg-blue-500/15 text-blue-300' : 'bg-slate-800 text-slate-300'}`}>
                {s.role}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(s)}
                disabled={lastOwner}
                title={lastOwner ? 'A tournament needs at least one owner' : undefined}
                aria-label={`Remove ${s.email}`}
                className="p-1.5 text-slate-400 hover:text-red-400 disabled:opacity-30 disabled:hover:text-slate-400"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          );
        })}
        {staff === undefined && <li className="px-3 py-3 text-sm text-slate-500">Loading…</li>}
      </ul>

      <form onSubmit={handleAdd} className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
          <div>
            <Label htmlFor="staff-email" className="text-xs">Email</Label>
            <Input id="staff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="auctioneer@example.com" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="staff-role" className="text-xs">Role</Label>
            <select id="staff-role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className="mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-800 px-2 text-sm text-white">
              <option value="auctioneer">Auctioneer</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <Button type="submit" disabled={busy || !email.trim()}>
            <UserPlus className="w-4 h-4" /> Add
          </Button>
        </div>
        <p className="text-xs text-slate-500">{ROLE_HINT[role]}</p>
      </form>
    </div>
  );
}
