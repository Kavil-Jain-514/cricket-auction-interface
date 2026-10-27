"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { Eye, Shield, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { cn, getErrorMessage } from '@/lib/utils';

type AccountType = 'team_owner' | 'visitor';

const OPTIONS: Array<{ value: AccountType; icon: typeof Shield; title: string; body: string }> = [
  {
    value: 'team_owner',
    icon: Shield,
    title: 'I own a team',
    body: 'Register your team in a tournament. The organiser verifies you, then you can bid for players from your phone.',
  },
  {
    value: 'visitor',
    icon: Eye,
    title: "I'm here to watch",
    body: 'Follow live auctions, teams and results.',
  },
];

/** Asked once after sign-up (and from "change" on the dashboard). */
export function AccountTypePrompt({ current, onClose }: { current?: AccountType; onClose?: () => void }) {
  const setAccountType = useMutation(api.auth.setAccountType);
  const [busy, setBusy] = useState<AccountType | null>(null);

  const choose = async (accountType: AccountType) => {
    setBusy(accountType);
    try {
      await setAccountType({ accountType });
      onClose?.();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save that'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="account-type-title" className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white shadow-2xl sm:p-6">
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        )}
        <h2 id="account-type-title" className="text-xl font-bold">Welcome to Bid11Pro</h2>
        <p className="mt-1 text-sm text-slate-400">How will you use it? You can change this later.</p>
        <div className="mt-5 grid gap-3">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={busy !== null}
              onClick={() => choose(o.value)}
              className={cn(
                'flex items-start gap-3 rounded-xl border p-4 text-left transition hover:border-blue-500 hover:bg-blue-500/10 disabled:opacity-60',
                current === o.value ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-800/50',
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30">
                <o.icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-semibold">{busy === o.value ? 'Saving…' : o.title}</span>
                <span className="mt-0.5 block text-sm text-slate-400">{o.body}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
