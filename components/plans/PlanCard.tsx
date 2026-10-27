"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Crown, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { PLAN_ORDER, PLAN_TIERS, upgradePrice, type PlanTier } from '@/convex/planTiers';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { openRazorpayCheckout } from '@/lib/razorpayCheckout';

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = Math.min(100, (used / max) * 100);
  const full = used >= max;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className={`tabular-nums ${full ? 'text-amber-300 font-semibold' : 'text-slate-200'}`}>{used}/{max}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${full ? 'bg-amber-400' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Plan, usage and upgrade, for the tournament's staff (upgrade: owners). */
export function PlanCard({
  tournamentId,
  tournamentName,
  canUpgrade,
  isSuperAdmin = false,
}: {
  tournamentId: Id<"tournaments">;
  tournamentName: string;
  canUpgrade: boolean;
  /** Platform operator: may grant a plan for an offline payment. */
  isSuperAdmin?: boolean;
}) {
  const usage = useQuery(api.plans.getPlanUsage, { tournamentId });
  const grantPlan = useMutation(api.plans.grantPlan);
  const [picking, setPicking] = useState(false);
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);
  const [grantTier, setGrantTier] = useState<PlanTier>('club');
  const [grantReason, setGrantReason] = useState('');

  const grant = async () => {
    try {
      await grantPlan({ tournamentId, tier: grantTier, reason: grantReason });
      toast.success(`${PLAN_TIERS[grantTier].label} plan granted`);
      setGrantReason('');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  if (!usage || !usage.tier || usage.maxTeams === null || usage.maxPlayers === null) return null;
  const current = usage.tier;
  const upgrades = PLAN_ORDER.filter((tier) => upgradePrice(current, tier) !== null);

  const buy = async (tier: PlanTier) => {
    setBusyTier(tier);
    try {
      const res = await fetch('/api/payments/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId, tier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not start the payment');
      await openRazorpayCheckout({
        keyId: data.keyId,
        orderId: data.orderId,
        amount: data.amount,
        currency: data.currency,
        description: `${PLAN_TIERS[tier].label} plan · ${tournamentName}`,
        onPaid: () => {
          setPicking(false);
          toast.success('Payment received. Your plan updates in a few seconds.');
        },
      });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyTier(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <Crown className="w-4 h-4 text-yellow-400" /> {PLAN_TIERS[current].label} plan
        </h3>
        {canUpgrade && upgrades.length > 0 && (
          <Button size="sm" onClick={() => setPicking(true)}>Upgrade</Button>
        )}
      </div>
      <div className="space-y-2.5">
        <Meter label="Teams" used={usage.teams} max={usage.maxTeams} />
        <Meter label="Players" used={usage.players} max={usage.maxPlayers} />
      </div>

      {isSuperAdmin && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-700 pt-3 text-xs">
          <span className="text-slate-400">Grant (offline payment):</span>
          <NativeSelect value={grantTier} onChange={(e) => setGrantTier(e.target.value as PlanTier)} className="h-8 w-auto" aria-label="Plan to grant">
            {PLAN_ORDER.map((tier) => <option key={tier} value={tier}>{PLAN_TIERS[tier].label}</option>)}
          </NativeSelect>
          <input value={grantReason} onChange={(e) => setGrantReason(e.target.value)} placeholder="Reason, e.g. bank transfer #123" className="h-8 flex-1 min-w-40 rounded-md border border-slate-600 bg-slate-800 px-2 text-white" aria-label="Reason" />
          <Button size="sm" variant="outline" disabled={!grantReason.trim()} onClick={grant} className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">Grant</Button>
        </div>
      )}

      {picking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPicking(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="plan-title" className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 text-white" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 id="plan-title" className="text-lg font-bold">Upgrade {tournamentName}</h2>
              <button onClick={() => setPicking(false)} aria-label="Close" className="p-1 text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <ul className="space-y-2">
              {upgrades.map((tier) => {
                const plan = PLAN_TIERS[tier];
                return (
                  <li key={tier} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 p-3">
                    <div>
                      <div className="font-semibold">{plan.label}</div>
                      <div className="text-xs text-slate-400">Up to {plan.maxTeams} teams · {plan.maxPlayers} players</div>
                    </div>
                    <Button size="sm" disabled={busyTier !== null} onClick={() => buy(tier)}>
                      {busyTier === tier ? 'Opening…' : `Pay ${rupees(upgradePrice(current, tier)!)}`}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-slate-500">One-time, for this tournament. You pay only the difference from your current plan. UPI, cards and netbanking via Razorpay.</p>
          </div>
        </div>
      )}
    </div>
  );
}
