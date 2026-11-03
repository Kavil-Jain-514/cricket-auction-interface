"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { Eye, Shield, Trophy, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { cn, getErrorMessage } from '@/lib/utils';

export type AccountType = 'organiser' | 'team_owner' | 'visitor';

const OPTIONS: Array<{ value: AccountType; icon: typeof Shield; title: string; body: string }> = [
  {
    value: 'organiser',
    icon: Trophy,
    title: 'I want to organise a tournament',
    body: 'Create tournaments, register players and teams, and run the live auction.',
  },
  {
    value: 'team_owner',
    icon: Shield,
    title: 'I own a team',
    body: 'Register your team in a tournament. The organiser verifies you, then you can bid for players from your phone.',
  },
  {
    value: 'visitor',
    icon: Eye,
    title: 'I am here to watch',
    body: 'Follow live auctions, teams and results.',
  },
];

/**
 * Asked once after sign-up (the /welcome step) and from "change" on the
 * dashboard. The server only accepts these three values.
 */
export function AccountTypePrompt({
  current,
  onClose,
  onChosen,
}: {
  current?: AccountType;
  onClose?: () => void;
  onChosen?: (accountType: AccountType) => void;
}) {
  const setAccountType = useMutation(api.auth.setAccountType);
  const [busy, setBusy] = useState<AccountType | null>(null);

  const choose = async (accountType: AccountType) => {
    setBusy(accountType);
    try {
      await setAccountType({ accountType });
      onChosen?.(accountType);
      onClose?.();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save that'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="account-type-title" className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white shadow-2xl sm:p-6">
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        )}
        <h2 id="account-type-title" className="text-xl font-bold">What are you here for?</h2>
        <p id="account-type-desc" className="mt-1 text-sm text-slate-400">Pick one to set up your dashboard. You can change this later.</p>
        <div role="group" aria-labelledby="account-type-title" aria-describedby="account-type-desc" className="mt-5 grid gap-3">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={busy !== null}
              aria-pressed={current === o.value}
              onClick={() => choose(o.value)}
              className={cn(
                'flex min-h-11 items-start gap-3 rounded-xl border p-4 text-left transition hover:border-blue-500 hover:bg-blue-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:opacity-60 motion-reduce:transition-none',
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
