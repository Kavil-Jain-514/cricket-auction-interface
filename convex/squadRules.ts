// convex/squadRules.ts
// Squad composition rules (e.g. max 2 Marquee, min 1 Wicket Keeper). Pure, like
// bidRules.ts: applyBid enforces them, getAuctionRoster displays them, and
// both read the same functions. Captains are never in a team's player list
// (no teamId), so — like the squad count — they don't count toward rules.
import { categoryFor, type PlayerCategory } from "./bidRules";

/** Exactly one of categoryId / role is set (checked by validateSquadRules). */
export interface SquadRule {
  id: string;
  categoryId?: string;
  role?: string;
  min?: number;
  max?: number;
}

export const SQUAD_RULE_ROLES = ["Batter", "Bowler", "All-Rounder", "Wicket Keeper"] as const;

const ROLE_ABBREVIATIONS: Record<string, string> = {
  Batter: "BAT",
  Bowler: "BOWL",
  "All-Rounder": "AR",
  "Wicket Keeper": "WK",
};

const LEGACY_ROLES: Record<string, string> = {
  "All Rounder": "All-Rounder",
  "Wicket-Keeper": "Wicket Keeper",
};

type RulePlayer = { role: string | string[]; categoryId?: string };

/** Player roles with legacy spellings mapped to the canonical ones. */
export function normaliseRoles(role: string | string[]): string[] {
  return (Array.isArray(role) ? role : [role]).map((r) => LEGACY_ROLES[r] ?? r);
}

export function ruleMatches(rule: SquadRule, player: RulePlayer): boolean {
  if (rule.categoryId) return player.categoryId === rule.categoryId;
  return !!rule.role && normaliseRoles(player.role).includes(rule.role);
}

/** Short label for a rule: the category name, or a role abbreviation (WK). */
export function ruleLabel(rule: SquadRule, categories: PlayerCategory[] | undefined): string {
  if (rule.categoryId) return categoryFor(rule.categoryId, categories)?.name ?? "Category";
  return ROLE_ABBREVIATIONS[rule.role ?? ""] ?? rule.role ?? "Role";
}

function countMatching(rule: SquadRule, players: RulePlayer[]): number {
  return players.filter((p) => ruleMatches(rule, p)).length;
}

/** Reason the team may not buy `player` under a max rule, or null. */
export function maxRuleViolation(
  rules: SquadRule[] | undefined,
  categories: PlayerCategory[] | undefined,
  teamPlayers: RulePlayer[],
  player: RulePlayer,
): string | null {
  for (const rule of rules ?? []) {
    if (rule.max === undefined || !ruleMatches(rule, player)) continue;
    const count = countMatching(rule, teamPlayers);
    if (count >= rule.max) {
      return `Team already has ${count} ${ruleLabel(rule, categories)} (max ${rule.max})`;
    }
  }
  return null;
}

/** Cheapest pending base price among players a rule would match. */
export type RulePrice = { ruleId: string; price: number };

/**
 * For each min rule still unmet after buying `player`: how many squad slots
 * it still needs, and the cheapest pending eligible price to reserve for each
 * (undefined when no eligible player is pending). Feeds maxAllowedBid.
 */
export function minRuleSlots(
  rules: SquadRule[] | undefined,
  teamPlayers: RulePlayer[],
  player: RulePlayer,
  rulePrices: RulePrice[] | undefined,
): Array<{ ruleId: string; unfilled: number; price: number | undefined }> {
  const slots = [];
  for (const rule of rules ?? []) {
    if (!rule.min) continue;
    const have = countMatching(rule, teamPlayers) + (ruleMatches(rule, player) ? 1 : 0);
    const unfilled = rule.min - have;
    if (unfilled > 0) {
      slots.push({
        ruleId: rule.id,
        unfilled,
        price: rulePrices?.find((p) => p.ruleId === rule.id)?.price,
      });
    }
  }
  return slots;
}

/** Cheapest pending price per rule, for tournament.auctionCounts. */
export function rulePricesFor(
  rules: SquadRule[] | undefined,
  pending: Array<RulePlayer & { basePrice: number }>,
): RulePrice[] {
  const prices: RulePrice[] = [];
  for (const rule of rules ?? []) {
    if (!rule.min) continue;
    const eligible = pending.filter((p) => ruleMatches(rule, p)).map((p) => p.basePrice);
    if (eligible.length > 0) prices.push({ ruleId: rule.id, price: Math.min(...eligible) });
  }
  return prices;
}

/** Per-rule count for a team card ("WK 0/1"). */
export function ruleStatus(
  rules: SquadRule[] | undefined,
  categories: PlayerCategory[] | undefined,
  teamPlayers: RulePlayer[],
): Array<{ ruleId: string; label: string; count: number; min?: number; max?: number; ok: boolean }> {
  return (rules ?? []).map((rule) => {
    const count = countMatching(rule, teamPlayers);
    return {
      ruleId: rule.id,
      label: ruleLabel(rule, categories),
      count,
      min: rule.min,
      max: rule.max,
      ok: count >= (rule.min ?? 0) && count <= (rule.max ?? Infinity),
    };
  });
}

/**
 * Reason the team can't take `player` because the remaining squad slots
 * couldn't fit every unmet minimum, or null.
 */
export function minRuleShortfall(
  slots: Array<{ ruleId: string; unfilled: number }>,
  rules: SquadRule[] | undefined,
  categories: PlayerCategory[] | undefined,
  futureSlots: number,
): string | null {
  const needed = slots.reduce((n, s) => n + s.unfilled, 0);
  if (needed <= futureSlots) return null;
  const labels = slots
    .map((s) => {
      const rule = rules?.find((r) => r.id === s.ruleId);
      return rule ? `${s.unfilled} ${ruleLabel(rule, categories)}` : null;
    })
    .filter(Boolean)
    .join(", ");
  // This purchase would use one of the futureSlots + 1 slots left.
  const left = futureSlots + 1;
  return `Team must keep ${left === 1 ? "its last slot" : `its last ${left} slots`} for ${labels}`;
}
