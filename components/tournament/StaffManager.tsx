"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Clock, Trash2, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { getErrorMessage } from '@/lib/utils';

type StaffRole = 'owner' | 'auctioneer' | 'registrar';

const ROLE_LABEL: Record<StaffRole, string> = {
  owner: 'Owner',
  auctioneer: 'Auctioneer',
  registrar: 'Registration admin',
};

const ROLE_HINT: Record<StaffRole, string> = {
  owner: 'Everything: settings, teams, players, staff, exports and the auction.',
  auctioneer: 'Runs the auction: bids, sales, corrections and purse tools. No settings, teams, players or staff.',
  registrar: 'Reviews player registrations: checks details and payments, then approves or rejects. Nothing else.',
};

const ROLE_BADGE: Record<StaffRole, string> = {
  owner: 'bg-blue-500/15 text-blue-300',
  auctioneer: 'bg-slate-800 text-slate-300',
  registrar: 'bg-emerald-500/15 text-emerald-300',
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Owners add or remove the people who can run this tournament. Anyone can be
 * invited by email, with or without a Bid11Pro account: the role is theirs
 * when they sign in (or sign up) with that address.
 */
export function StaffManager({ tournamentId }: { tournamentId: Id<"tournaments"> }) {
  const staff = useQuery(api.staff.list, { tournamentId });
  const invites = useQuery(api.staff.listInvites, { tournamentId });
  const addStaff = useMutation(api.staff.add);
  const removeStaff = useMutation(api.staff.remove);
  const revokeInvite = useMutation(api.staff.revokeInvite);
  const confirm = useConfirm();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('auctioneer');
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const ownerCount = (staff ?? []).filter((s) => s.role === 'owner').length;

  // Not a <form>: this sits inside the settings form.
  const handleAdd = async () => {
    const address = email.trim();
    if (!address) return;
    if (!EMAIL.test(address)) {
      setEmailError('Enter a valid email address, like name@example.com.');
      return;
    }
    setEmailError(null);
    setBusy(true);
    try {
      await addStaff({ tournamentId, email: address, role });
      toast.success(`Invited ${address} as ${ROLE_LABEL[role].toLowerCase()}`, {
        description: "We've emailed them. They get access when they sign in, or create a free account, with this email.",
      });
      setEmail('');
    } catch (error) {
      setEmailError(getErrorMessage(error, 'Could not invite them'));
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

  const handleRevoke = async (invite: { _id: Id<"staffInvites">; email: string }) => {
    try {
      await revokeInvite({ inviteId: invite._id });
      toast.success(`Invite to ${invite.email} withdrawn`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not withdraw the invite'));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-slate-300">Staff</h3>
        <p className="text-xs text-slate-400 mt-1">
          People who can run this tournament. Invite anyone by email; they don&apos;t need a Bid11Pro account yet.
        </p>
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
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_BADGE[s.role]}`}>{ROLE_LABEL[s.role]}</span>
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
        {(invites ?? []).map((i) => (
          <li key={i._id} className="flex items-center gap-3 px-3 py-2.5">
            <Clock className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{i.email}</div>
              <div className="truncate text-xs text-amber-300/80">Invited · gets access when they sign in</div>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_BADGE[i.role]}`}>{ROLE_LABEL[i.role]}</span>
            <button
              type="button"
              onClick={() => handleRevoke(i)}
              aria-label={`Withdraw the invite to ${i.email}`}
              className="p-1.5 text-slate-400 hover:text-red-400"
            >
              <X className="w-4 h-4" />
            </button>
          </li>
        ))}
        {staff === undefined && <li className="px-3 py-3 text-sm text-slate-500">Loading…</li>}
      </ul>

      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
          <div>
            <Label htmlFor="staff-email" className="text-xs">Email</Label>
            <Input
              id="staff-email"
              type="email"
              value={email}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? 'staff-email-error' : undefined}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder="name@example.com"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="staff-role" className="text-xs">Role</Label>
            <NativeSelect id="staff-role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className="mt-1 h-9">
              <option value="auctioneer">Auctioneer</option>
              <option value="registrar">Registration admin</option>
              <option value="owner">Owner</option>
            </NativeSelect>
          </div>
          <Button type="button" onClick={handleAdd} disabled={busy || !email.trim()}>
            <UserPlus className="w-4 h-4" /> {busy ? 'Inviting…' : 'Invite'}
          </Button>
        </div>
        {emailError && (
          <p id="staff-email-error" role="alert" className="text-xs text-red-400">{emailError}</p>
        )}
        <p className="text-xs text-slate-500">{ROLE_HINT[role]}</p>
      </div>
    </div>
  );
}
