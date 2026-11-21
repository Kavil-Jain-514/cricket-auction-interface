"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Crown, Gift } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { PLAN_ORDER, PLAN_TIERS, upgradePrice, type PlanTier } from '@/convex/planTiers';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { FormModal, SectionHeading } from '@/components/ui/form-modal';
import { openRazorpayCheckout } from '@/lib/razorpayCheckout';
import { formatRupees } from '@/convex/bidRules';
import { getErrorMessage } from '@/lib/utils';

const rupees = (paise: number) => formatRupees(paise / 100);

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = Math.min(100, (used / max) * 100);
  const full = used >= max;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-400">{label}</span>
        <span className={`tabular-nums ${full ? 'text-amber-300 font-semibold' : 'text-slate-200'}`}>{used}/{max}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${full ? 'bg-amber-400' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Plan, usage and upgrade, for the tournament's staff (upgrade: owners).
 * A compact header button showing the tier; the details open in a popup.
 */
export function PlanButton({
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
  const [open, setOpen] = useState(false);
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);
  const [grantTier, setGrantTier] = useState<PlanTier>('club');
  const [grantReason, setGrantReason] = useState('');
  const [granting, setGranting] = useState(false);

  if (!usage || !usage.tier || usage.maxTeams === null || usage.maxPlayers === null) return null;
  const current = usage.tier;
  const upgrades = PLAN_ORDER.filter((tier) => upgradePrice(current, tier) !== null);
  const atLimit = usage.teams >= usage.maxTeams || usage.players >= usage.maxPlayers;

  const grant = async () => {
    setGranting(true);
    try {
      await grantPlan({ tournamentId, tier: grantTier, reason: grantReason });
      toast.success(`${PLAN_TIERS[grantTier].label} plan granted`);
      setGrantReason('');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setGranting(false);
    }
  };

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
          setOpen(false);
          toast.success('Payment received. Your plan updates in a few seconds.');
        },
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyTier(null);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        title={`${usage.teams}/${usage.maxTeams} teams · ${usage.players}/${usage.maxPlayers} players`}
        className={`h-11 px-4 text-sm ${atLimit ? 'border-amber-600/60 text-amber-300 hover:bg-amber-600/10 hover:text-amber-200' : 'border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white'}`}
      >
        <Crown className="w-4 h-4 mr-2 text-yellow-400" aria-hidden />
        {PLAN_TIERS[current].label} plan
        {atLimit && <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold">Limit reached</span>}
      </Button>

      {open && (
        <FormModal
          icon={Crown}
          title={`${PLAN_TIERS[current].label} plan`}
          subtitle={tournamentName}
          onClose={() => setOpen(false)}
          width="lg"
          footer={
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-10 sm:min-w-28">Close</Button>
            </div>
          }
        >
          <div className="space-y-3">
            <Meter label="Teams" used={usage.teams} max={usage.maxTeams} />
            <Meter label="Players" used={usage.players} max={usage.maxPlayers} />
          </div>

          {canUpgrade && upgrades.length > 0 && (
            <div className="mt-5">
              <SectionHeading icon={Crown} title="Upgrade" hint="pay only the difference" />
              <ul className="space-y-2">
                {upgrades.map((tier) => {
                  const plan = PLAN_TIERS[tier];
                  return (
                    <li key={tier} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 p-3">
                      <div>
                        <div className="font-semibold">{plan.label}</div>
                        <div className="text-xs text-slate-400">Up to {plan.maxTeams} teams · {plan.maxPlayers} players</div>
                      </div>
                      <Button type="button" size="sm" disabled={busyTier !== null} onClick={() => buy(tier)}>
                        {busyTier === tier ? 'Opening…' : `Pay ${rupees(upgradePrice(current, tier)!)}`}
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-slate-500">One-time, for this tournament. UPI, cards and netbanking via Razorpay.</p>
            </div>
          )}

          {isSuperAdmin && (
            <div className="mt-5 border-t border-slate-800 pt-4">
              <SectionHeading icon={Gift} title="Grant a plan" hint="offline payment, super-admin" />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <NativeSelect value={grantTier} onChange={(e) => setGrantTier(e.target.value as PlanTier)} className="h-10 w-auto" aria-label="Plan to grant">
                  {PLAN_ORDER.map((tier) => <option key={tier} value={tier}>{PLAN_TIERS[tier].label}</option>)}
                </NativeSelect>
                <input value={grantReason} onChange={(e) => setGrantReason(e.target.value)} placeholder="Reason, e.g. bank transfer #123" className="h-10 flex-1 min-w-40 rounded-md border border-slate-600 bg-slate-800 px-3 text-white" aria-label="Reason" />
                <Button type="button" variant="outline" disabled={!grantReason.trim() || granting} onClick={grant} className="h-10 border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white">
                  {granting ? 'Granting…' : 'Grant'}
                </Button>
              </div>
            </div>
          )}
        </FormModal>
      )}
    </>
  );
}
