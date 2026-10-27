// convex/planTiers.ts - Plan tiers, prices and limits. Pure (no server
// imports) so the pricing UI, the order route and the webhook all read the
// same table.

export type PlanTier = "free" | "club" | "league" | "pro";

/** Prices in rupees, per tournament. Agreed 2026-10-26. */
export const PLAN_TIERS: Record<PlanTier, { label: string; price: number; maxTeams: number; maxPlayers: number }> = {
  free: { label: "Free", price: 0, maxTeams: 4, maxPlayers: 60 },
  club: { label: "Club", price: 999, maxTeams: 8, maxPlayers: 150 },
  league: { label: "League", price: 2999, maxTeams: 12, maxPlayers: 250 },
  pro: { label: "Pro", price: 6999, maxTeams: 20, maxPlayers: 500 },
};

export const PLAN_ORDER: PlanTier[] = ["free", "club", "league", "pro"];

/** The plan a new tournament starts on. */
export function initialPlan(): { tier: PlanTier; maxTeams: number; maxPlayers: number } {
  const { maxTeams, maxPlayers } = PLAN_TIERS.free;
  return { tier: "free", maxTeams, maxPlayers };
}

/** Limits for a tournament, or null when it predates plans (unlimited). */
export function planLimits(tournament: {
  plan?: { tier?: string; maxTeams: number; maxPlayers: number };
}): { maxTeams: number; maxPlayers: number } | null {
  return tournament.plan
    ? { maxTeams: tournament.plan.maxTeams, maxPlayers: tournament.plan.maxPlayers }
    : null;
}


/**
 * What an upgrade costs, in paise: the difference between the target tier
 * and the current one (Club -> League pays ₹2,000). Null when it isn't an
 * upgrade.
 */
export function upgradePrice(current: PlanTier, target: PlanTier): number | null {
  if (PLAN_ORDER.indexOf(target) <= PLAN_ORDER.indexOf(current)) return null;
  return (PLAN_TIERS[target].price - PLAN_TIERS[current].price) * 100;
}
