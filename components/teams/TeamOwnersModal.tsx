"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { X, Copy, MessageCircle, UserPlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/utils';
import { useConfirm } from '@/components/ui/confirm-dialog';

interface TeamOwnersModalProps {
  team: Doc<"teams">;
  onClose: () => void;
}

/**
 * Admin-only: invite team owners (one-time /join/<token> links) and manage who
 * can bid for the team. The token is shown once, right after it is created —
 * the server keeps only its hash, so a lost link is replaced, not recovered.
 */
export function TeamOwnersModal({ team, onClose }: TeamOwnersModalProps) {
  const listing = useQuery(api.members.listMembers, { teamId: team._id });
  const createInvite = useMutation(api.members.createInvite);
  const removeMember = useMutation(api.members.removeMember);
  const revokeInvite = useMutation(api.members.revokeInvite);
  const confirm = useConfirm();

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const { token } = await createInvite({ teamId: team._id });
      setInviteLink(`${window.location.origin}/join/${token}`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to create invite'));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success('Invite link copied');
    } catch {
      toast.error('Could not copy — select the link and copy it manually');
    }
  };

  const whatsappUrl = inviteLink
    ? `https://wa.me/?text=${encodeURIComponent(
        `You're invited to bid for ${team.name} on Bid11Pro. Open this link to join (valid 7 days, one use): ${inviteLink}`,
      )}`
    : null;

  const handleRemove = async (memberId: Id<"teamMembers">, email: string) => {
    if (!(await confirm({
      title: `Remove ${email}?`,
      description: 'They will no longer be able to bid for this team. Any raise they have waiting is rejected.',
      confirmText: 'Remove',
      variant: 'danger',
    }))) return;
    try {
      await removeMember({ memberId });
      toast.success('Owner removed');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to remove owner'));
    }
  };

  const handleRevoke = async (inviteId: Id<"teamInvites">) => {
    try {
      const res = await revokeInvite({ inviteId });
      if (!res.success) toast.error(res.reason);
      else toast.success('Invite revoked');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to revoke invite'));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-5 sm:p-6 my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl sm:text-2xl font-bold">Owners · {team.name}</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* New invite */}
        <div className="mb-5">
          {inviteLink ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">
                Share this link with the owner. It works once and expires in 7 days.
              </p>
              <input
                readOnly
                value={inviteLink}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-xs sm:text-sm font-mono text-slate-200"
              />
              <div className="flex gap-2">
                <Button type="button" onClick={handleCopy} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white">
                  <Copy /> Copy link
                </Button>
                <Button asChild className="flex-1 bg-green-600 hover:bg-green-700 text-white">
                  <a href={whatsappUrl!} target="_blank" rel="noopener noreferrer">
                    <MessageCircle /> WhatsApp
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" onClick={handleCreate} disabled={creating} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
              <UserPlus /> {creating ? 'Creating…' : 'Invite owner'}
            </Button>
          )}
        </div>

        {/* Members */}
        <div className="space-y-2 mb-4">
          <h3 className="text-sm font-semibold text-slate-300">Owners</h3>
          {listing === undefined ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : !listing || listing.members.length === 0 ? (
            <p className="text-xs text-slate-500">No owners yet.</p>
          ) : (
            listing.members.map((m) => (
              <div key={m._id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/60 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm truncate">{m.name || m.email}</p>
                  {m.name && <p className="text-xs text-slate-500 truncate">{m.email}</p>}
                </div>
                <button
                  onClick={() => handleRemove(m._id, m.email)}
                  className="p-2 rounded-lg text-slate-400 hover:bg-red-500/15 hover:text-red-400 transition shrink-0"
                  aria-label={`Remove ${m.email}`}
                  title="Remove owner"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Open invites */}
        {listing && listing.invites.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-300">Unused invites</h3>
            {listing.invites.map((inv) => (
              <div key={inv._id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/60 px-3 py-2">
                <span className="text-xs text-slate-400">
                  Expires {new Date(inv.expiresAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => handleRevoke(inv._id)}
                  className="text-xs font-semibold text-red-400 hover:text-red-300 px-2 py-1"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
