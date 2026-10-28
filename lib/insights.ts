// lib/insights.ts - Rule-based squad insights for team owners (no AI).
// Pure functions over data the paddle and the results page already load; each
// owner only ever sees insights for their own team.
import { normaliseRoles, SQUAD_RULE_ROLES, type SquadRule } from '@/convex/squadRules';

type RolePlayer = { role: string | string[] };

export interface RoleBalanceRow {
  role: (typeof SQUAD_RULE_ROLES)[number];
  count: number;
  min?: number;
  max?: number;
  /** Players still needed to reach the minimum (0 when met or no minimum). */
  gap: number;
}

/** Squad count for every role against the role-based squad rules. */
export function roleBalance(squad: RolePlayer[], squadRules: SquadRule[] | undefined): RoleBalanceRow[] {
  return SQUAD_RULE_ROLES.map((role) => {
    const rule = squadRules?.find((r) => r.role === role);
    const count = squad.filter((p) => normaliseRoles(p.role).includes(role)).length;
    return { role, count, min: rule?.min, max: rule?.max, gap: Math.max(0, (rule?.min ?? 0) - count) };
  });
}

/** "You need 1 WK, 2 Bowler" from per-rule status (roles and categories), or null. */
export function needsSummary(status: Array<{ label: string; count: number; min?: number }>): string | null {
  const needs = status
    .filter((s) => s.min !== undefined && s.count < s.min)
    .map((s) => `${s.min! - s.count} ${s.label}`);
  return needs.length > 0 ? `You need ${needs.join(', ')}` : null;
}

export type PaceTone = 'good' | 'warning' | 'critical';

/**
 * Rupees per remaining squad slot, coloured against the tournament average
 * per slot: good at 90%+ of it, warning from 60%, critical below that or
 * when the purse can't buy the cheapest player for every slot.
 */
export function budgetPace({
  purse,
  slotsLeft,
  cheapestBase,
  tournamentAvgPerSlot,
}: {
  purse: number;
  slotsLeft: number;
  cheapestBase: number;
  tournamentAvgPerSlot: number;
}): { perSlot: number | null; tone: PaceTone } {
  if (slotsLeft <= 0) return { perSlot: null, tone: 'good' };
  const perSlot = Math.floor(purse / slotsLeft);
  if (perSlot < cheapestBase) return { perSlot, tone: 'critical' };
  if (tournamentAvgPerSlot <= 0) return { perSlot, tone: 'good' };
  const ratio = perSlot / tournamentAvgPerSlot;
  return { perSlot, tone: ratio >= 0.9 ? 'good' : ratio >= 0.6 ? 'warning' : 'critical' };
}

/** Linear-interpolated percentile of an ascending list. */
function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

export const MIN_COMPARABLE_SALES = 3;

/**
 * What similar players (same category, or both uncategorised, sharing a role)
 * have sold for in this auction: median and interquartile range. Null until
 * MIN_COMPARABLE_SALES comparable sales exist.
 */
export function fairValueBand(
  player: { role: string | string[]; categoryId?: string },
  soldHistory: Array<{ soldPrice: number; role: string | string[]; categoryId?: string }>,
): { median: number; low: number; high: number; count: number } | null {
  const roles = normaliseRoles(player.role);
  const prices = soldHistory
    .filter((s) => s.categoryId === player.categoryId && normaliseRoles(s.role).some((r) => roles.includes(r)))
    .map((s) => s.soldPrice)
    .sort((a, b) => a - b);
  if (prices.length < MIN_COMPARABLE_SALES) return null;
  return { median: percentile(prices, 0.5), low: percentile(prices, 0.25), high: percentile(prices, 0.75), count: prices.length };
}

/** The buy with the lowest sold-price to base-price ratio. */
export function bestValueBuy<P extends { soldPrice: number; basePrice: number }>(squad: P[]): P | null {
  let best: P | null = null;
  for (const p of squad) {
    if (p.basePrice <= 0) continue;
    if (!best || p.soldPrice / p.basePrice < best.soldPrice / best.basePrice) best = p;
  }
  return best;
}

/** Everything the owner paddle shows for the owner's own team. */
export function ownerInsights(
  roster: {
    teams: Array<{ _id: string; purseRemaining: number; playersNeeded: number; ruleStatus?: Array<{ label: string; count: number; min?: number }> }>;
    soldPlayers: Array<{ soldPrice?: number; role: string | string[]; categoryId?: string }>;
    currentPlayer: { role: string | string[]; categoryId?: string } | null;
    minBasePrice?: number;
  },
  teamId: string,
) {
  const team = roster.teams.find((t) => t._id === teamId);
  if (!team) return null;
  const open = roster.teams.filter((t) => t.playersNeeded > 0);
  const avg = open.length ? open.reduce((sum, t) => sum + t.purseRemaining / t.playersNeeded, 0) / open.length : 0;
  const history = roster.soldPlayers.map((p) => ({ soldPrice: p.soldPrice ?? 0, role: p.role, categoryId: p.categoryId }));
  return {
    needs: needsSummary(team.ruleStatus ?? []),
    pace: budgetPace({
      purse: team.purseRemaining,
      slotsLeft: team.playersNeeded,
      cheapestBase: roster.minBasePrice ?? 0,
      tournamentAvgPerSlot: avg,
    }),
    fairValue: roster.currentPlayer ? fairValueBand(roster.currentPlayer, history) : null,
  };
}
