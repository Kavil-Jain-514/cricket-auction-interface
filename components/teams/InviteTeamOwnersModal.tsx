"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Copy, Mail, MessageCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getErrorMessage } from '@/lib/utils';

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: 'sending', cls: 'text-slate-400' },
  sending: { label: 'sending', cls: 'text-slate-400' },
  sent: { label: 'sent', cls: 'text-green-300' },
  failed: { label: 'not delivered', cls: 'text-red-300' },
  skipped: { label: 'not sent', cls: 'text-amber-300' },
};

/**
 * Owner-only: invite team owners to add their own team. Share the team
 * sign-up link, or email it. Registered teams then wait under "Teams waiting
 * for verification" on the Teams page.
 */
export function InviteTeamOwnersModal({
  tournamentId,
  tournamentName,
  onClose,
}: {
  tournamentId: Id<"tournaments">;
  tournamentName: string;
  onClose: () => void;
}) {
  const invites = useQuery(api.teamRequests.listOwnerInvites, { tournamentId });
  const inviteOwner = useMutation(api.teamRequests.inviteOwner);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const link = `${window.location.origin}/tournament/${tournamentId}/join-team`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(
    `You're invited to add your team to ${tournamentName} on Bid11Pro. Register it here: ${link}`,
  )}`;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    try {
      await inviteOwner({ tournamentId, email });
      toast.success(`Invitation emailed to ${email.trim()}`);
      setEmail('');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not send the invitation'));
    } finally {
      setSending(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-owners-title"
        className="my-auto w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 id="invite-owners-title" className="text-xl font-bold sm:text-2xl">Invite team owners</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 transition hover:bg-slate-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-5 text-sm text-slate-400">
          Owners register their own team (name, colours, logo). You verify each one under &ldquo;Teams waiting for
          verification&rdquo;, then they can bid from their phone.
        </p>

        <section aria-labelledby="share-link-title" className="mb-5 space-y-2">
          <h3 id="share-link-title" className="text-sm font-semibold text-slate-300">Share the team sign-up link</h3>
          <input
            readOnly
            value={link}
            aria-label="Team sign-up link"
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-200 sm:text-sm"
          />
          <div className="flex gap-2">
            <Button type="button" onClick={copy} className="min-h-11 flex-1 bg-blue-600 text-white hover:bg-blue-700">
              <Copy /> Copy link
            </Button>
            <Button asChild className="min-h-11 flex-1 bg-green-600 text-white hover:bg-green-700">
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle /> WhatsApp
              </a>
            </Button>
          </div>
        </section>

        <form onSubmit={send} className="mb-5 space-y-2" aria-labelledby="email-invite-title">
          <h3 id="email-invite-title" className="text-sm font-semibold text-slate-300">Or email an invitation</h3>
          <div className="flex gap-2">
            <label htmlFor="team-owner-email" className="sr-only">Team owner&apos;s email</label>
            <Input
              id="team-owner-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@example.com"
              className="h-11 flex-1"
            />
            <Button type="submit" disabled={sending || !email.trim()} className="min-h-11">
              <Mail /> {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>

        {invites && invites.length > 0 && (
          <section aria-labelledby="invited-title" className="space-y-2">
            <h3 id="invited-title" className="text-sm font-semibold text-slate-300">Invited</h3>
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {invites.map((inv) => (
                <li key={inv._id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/60 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{inv.email}</span>
                  <span className={`shrink-0 text-xs ${STATUS[inv.status].cls}`}>
                    {STATUS[inv.status].label} · {new Date(inv.createdAt).toLocaleDateString('en-IN')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-5 text-xs text-slate-400">
          Already created the team yourself? Use <strong>Owners</strong> on its card to invite its owner instead.
        </p>
      </div>
    </div>
  );
}
