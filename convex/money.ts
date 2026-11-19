// convex/money.ts - Rebuilding team purses from the source of truth.
// The invariants (CLAUDE.md): for every team,
//   purseSpent == sum(soldPrice of its sold players)
//   purseRemaining + purseSpent == settings.basePurse + purseAdjustment
// recomputeTeamPurses derives both stored figures from the players, so any
// path that rewrites player state in bulk (snapshot restore, ending a
// rehearsal) can finish with purses that are correct by construction.
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { teamPurseTotal } from "./bidRules";

/** A team's purse as its sold players and adjustment say it should be. */
export function purseFromSales(
  basePurse: number,
  team: { purseAdjustment?: number },
  soldPrices: number[],
): { purseSpent: number; purseRemaining: number } {
  const purseSpent = soldPrices.reduce((sum, price) => sum + price, 0);
  return { purseSpent, purseRemaining: teamPurseTotal(basePurse, team) - purseSpent };
}

/**
 * Set every team's purseSpent / purseRemaining in a tournament from its sold
 * players. Writes only teams whose stored figures differ, and returns their
 * ids (for the caller's audit row). Callers check access and audit.
 */
export async function recomputeTeamPurses(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
): Promise<Id<"teams">[]> {
  const tournament = await ctx.db.get(tournamentId);
  if (!tournament) return [];
  const [teams, sold] = await Promise.all([
    ctx.db.query("teams").withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)).collect(),
    ctx.db
      .query("players")
      .withIndex("by_tournament_status", (q) => q.eq("tournamentId", tournamentId).eq("auctionStatus", "sold"))
      .collect(),
  ]);
  const pricesByTeam = new Map<Id<"teams">, number[]>();
  for (const p of sold) {
    if (!p.teamId) continue;
    pricesByTeam.set(p.teamId, [...(pricesByTeam.get(p.teamId) ?? []), p.soldPrice ?? 0]);
  }

  const changed: Id<"teams">[] = [];
  const now = Date.now();
  for (const team of teams as Doc<"teams">[]) {
    const next = purseFromSales(tournament.settings.basePurse, team, pricesByTeam.get(team._id) ?? []);
    if (next.purseSpent !== team.purseSpent || next.purseRemaining !== team.purseRemaining) {
      await ctx.db.patch(team._id, { ...next, updatedAt: now });
      changed.push(team._id);
    }
  }
  return changed;
}
