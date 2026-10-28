"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Wallet, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { teamPurseTotal } from '@/convex/bidRules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ReconciliationBadge } from '@/components/auction/ReconciliationBadge';
import { formatCurrency, getErrorMessage } from '@/lib/utils';

interface PurseToolsProps {
  team: {
    _id: Id<"teams">;
    tournamentId: Id<"tournaments">;
    name: string;
    purseRemaining: number;
    purseSpent: number;
    purseAdjustment?: number;
  };
  players: Array<{ auctionStatus: string; soldPrice?: number }>;
}

type Pending = 'adjust' | 'recalculate' | null;

/**
 * Admin purse tools on the team modal: adjust (penalty / top-up, kept in the
 * purseAdjustment ledger) and recalculate (repair from sold players). Both
 * need a reason and the team's name typed to confirm; the reconciliation
 * badge shows the totals before and, reactively, after.
 */
export function PurseTools({ team, players }: PurseToolsProps) {
  const tournament = useQuery(api.tournaments.getById, { id: team.tournamentId });
  const adjustTeamPurse = useMutation(api.admin.adjustTeamPurse);
  const recalculateTeamPurse = useMutation(api.admin.recalculateTeamPurse);

  const [direction, setDirection] = useState<'add' | 'deduct'>('deduct');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const value = Number(amount);
  const signed = Number.isInteger(value) && value > 0 ? (direction === 'add' ? value : -value) : 0;
  const adjustedRemaining = team.purseRemaining + signed;

  const soldTotal = players.filter((p) => p.auctionStatus === 'sold').reduce((s, p) => s + (p.soldPrice ?? 0), 0);
  const purseTotal = tournament ? teamPurseTotal(tournament.settings.basePurse, team) : undefined;
  const recalculatedRemaining = purseTotal !== undefined ? purseTotal - soldTotal : undefined;
  const inSync = soldTotal === team.purseSpent && recalculatedRemaining === team.purseRemaining;

  const nameMatches = typed.trim().toLowerCase() === team.name.trim().toLowerCase();
  const reasonOk = reason.trim().length > 0;

  const open = (which: Exclude<Pending, null>) => {
    setTyped('');
    setPending(which);
  };

  const run = async () => {
    if (!nameMatches || !reasonOk || !pending) return;
    setBusy(true);
    try {
      if (pending === 'adjust') {
        await adjustTeamPurse({ teamId: team._id, amount: signed, reason });
        toast.success(`${team.name}: ${signed > 0 ? 'added' : 'deducted'} ${formatCurrency(Math.abs(signed))}`);
        setAmount('');
      } else {
        await recalculateTeamPurse({ teamId: team._id, reason });
        toast.success(`${team.name}'s purse recalculated`);
      }
      setReason('');
      setPending(null);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not change the purse'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-4" aria-labelledby="purse-tools-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="purse-tools-title" className="flex items-center gap-2 font-semibold">
          <Wallet className="w-4 h-4 text-amber-400" /> Purse tools
        </h3>
        <ReconciliationBadge tournamentId={team.tournamentId} />
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        {[
          ['Remaining', team.purseRemaining],
          ['Spent', team.purseSpent],
          ['Adjustments', team.purseAdjustment ?? 0],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg bg-slate-900/60 p-2">
            <dt className="text-xs text-slate-400">{k}</dt>
            <dd className="font-semibold tabular-nums">
              {(v as number) > 0 && k === 'Adjustments' ? '+' : ''}
              {(v as number) < 0 ? '−' : ''}
              {formatCurrency(Math.abs(v as number))}
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <Label htmlFor="purse-reason" className="text-xs">Reason (required, saved to the audit log)</Label>
        <Input id="purse-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Penalty for late arrival" className="mt-1" />
      </div>

      {/* Adjust */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex rounded-md border border-slate-600 p-0.5" role="radiogroup" aria-label="Add or deduct">
            {(['deduct', 'add'] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={direction === d}
                onClick={() => setDirection(d)}
                className={`rounded px-3 py-1.5 text-sm font-medium ${direction === d ? 'bg-slate-700 text-white' : 'text-slate-400'}`}
              >
                {d === 'add' ? 'Add' : 'Deduct'}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-32">
            <Label htmlFor="purse-amount" className="text-xs">Amount (₹)</Label>
            <Input id="purse-amount" type="number" min="1" step="1000" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" />
          </div>
          <Button type="button" disabled={signed === 0 || !reasonOk || adjustedRemaining < 0} onClick={() => open('adjust')}>
            Adjust purse…
          </Button>
        </div>
        {signed !== 0 && (
          <p className={`text-xs ${adjustedRemaining < 0 ? 'text-red-400' : 'text-slate-400'}`}>
            Remaining {formatCurrency(team.purseRemaining)} → {adjustedRemaining < 0 ? 'below zero' : formatCurrency(adjustedRemaining)}
          </p>
        )}
      </div>

      {/* Recalculate */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700/60 pt-3">
        <p className="text-xs text-slate-400">
          {recalculatedRemaining === undefined
            ? 'Checking…'
            : inSync
              ? 'Already matches its sold players.'
              : `Rebuild from sold players: spent ${formatCurrency(team.purseSpent)} → ${formatCurrency(soldTotal)}, remaining ${formatCurrency(team.purseRemaining)} → ${formatCurrency(recalculatedRemaining)}`}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={!reasonOk || recalculatedRemaining === undefined}
          onClick={() => open('recalculate')}
          className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
        >
          <Calculator className="w-4 h-4" /> Recalculate purse…
        </Button>
      </div>

      {/* Typed confirmation */}
      {pending && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 space-y-2" role="alertdialog" aria-labelledby="purse-confirm-title">
          <p id="purse-confirm-title" className="text-sm font-semibold text-red-200">
            {pending === 'adjust'
              ? `${signed > 0 ? 'Add' : 'Deduct'} ${formatCurrency(Math.abs(signed))} ${signed > 0 ? 'to' : 'from'} ${team.name}?`
              : `Recalculate ${team.name}'s purse from its sold players?`}
          </p>
          <Label htmlFor="purse-confirm" className="text-xs text-slate-300">Type <b>{team.name}</b> to confirm</Label>
          <Input id="purse-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPending(null)} className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={!nameMatches || busy} onClick={run}>
              {busy ? 'Saving…' : 'Confirm'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
