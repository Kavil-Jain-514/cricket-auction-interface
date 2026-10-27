// lib/razorpayOrder.ts - The Razorpay Orders API request for a plan upgrade.
// Pure, so the amount and notes the webhook later relies on are unit-tested.
import { PLAN_TIERS, upgradePrice, type PlanTier } from '@/convex/planTiers';

export interface RazorpayOrderRequest {
  amount: number; // paise
  currency: 'INR';
  receipt: string;
  notes: { tournamentId: string; tier: PlanTier; purpose: string };
}

/** Null when `target` isn't an upgrade from `current`. */
export function buildOrderRequest(
  tournamentId: string,
  current: PlanTier,
  target: PlanTier,
): RazorpayOrderRequest | null {
  const amount = upgradePrice(current, target);
  if (amount === null) return null;
  return {
    amount,
    currency: 'INR',
    // Razorpay caps receipt at 40 characters.
    receipt: `plan_${target}_${tournamentId.slice(-20)}`.slice(0, 40),
    notes: { tournamentId, tier: target, purpose: `Bid11Pro ${PLAN_TIERS[target].label} plan` },
  };
}
