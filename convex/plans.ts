// convex/plans.ts - Per-tournament plans (organiser SaaS tiers): limits
// enforced on create, usage for the UI, and the super-admin manual grant.
// Tiers and prices live in planTiers.ts (pure, safe to import client-side).
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { logAdminAction, requireAdmin, requireTournamentRole, RUN_AUCTION } from "./auth";
import { planTierValidator } from "./ruleValidators";
import { PLAN_TIERS, planLimits } from "./planTiers";

export { PLAN_ORDER, PLAN_TIERS, initialPlan, planLimits, type PlanTier } from "./planTiers";

function planName(tournament: Doc<"tournaments">): string {
  return tournament.plan ? PLAN_TIERS[tournament.plan.tier].label : "current";
}

/** Throws when adding one more team would exceed the plan. */
export function assertTeamCapacity(tournament: Doc<"tournaments">, existingTeams: number): void {
  const limits = planLimits(tournament);
  if (limits && existingTeams + 1 > limits.maxTeams) {
    throw new Error(
      `Your ${planName(tournament)} plan allows ${limits.maxTeams} teams. Upgrade the tournament's plan to add more.`,
    );
  }
}

/** Throws when adding `adding` players would exceed the plan. */
export function assertPlayerCapacity(
  tournament: Doc<"tournaments">,
  existingPlayers: number,
  adding: number,
): void {
  const limits = planLimits(tournament);
  if (limits && existingPlayers + adding > limits.maxPlayers) {
    const room = Math.max(0, limits.maxPlayers - existingPlayers);
    throw new Error(
      `Your ${planName(tournament)} plan allows ${limits.maxPlayers} players (room for ${room} more). Upgrade the tournament's plan to add more.`,
    );
  }
}

/** Plan, limits and current usage for the tournament's staff. */
export const getPlanUsage = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) return null;
    await requireTournamentRole(ctx, args.tournamentId, RUN_AUCTION);
    const [teams, players] = await Promise.all([
      ctx.db
        .query("teams")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect(),
      ctx.db
        .query("players")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect(),
    ]);
    const limits = planLimits(tournament);
    return {
      tier: tournament.plan?.tier ?? null,
      maxTeams: limits?.maxTeams ?? null,
      maxPlayers: limits?.maxPlayers ?? null,
      paidAt: tournament.plan?.paidAt,
      teams: teams.length,
      players: players.length,
    };
  },
});

/**
 * Super-admin: set a tournament's plan without a card payment (bank
 * transfer, a comped event). Logged with the reason.
 */
export const grantPlan = mutation({
  args: { tournamentId: v.id("tournaments"), tier: planTierValidator, reason: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) throw new Error("Tournament not found");
    const reason = args.reason.trim();
    if (!reason) throw new Error("A reason is required");

    const { maxTeams, maxPlayers } = PLAN_TIERS[args.tier];
    const plan = { tier: args.tier, maxTeams, maxPlayers, paidAt: Date.now(), paymentRef: `manual: ${reason}` };
    await ctx.db.patch(args.tournamentId, { plan, updatedAt: Date.now() });
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "grant_plan",
      targetType: "tournament",
      targetId: args.tournamentId,
      previousData: { plan: tournament.plan },
      newData: { plan },
      tournamentId: args.tournamentId,
    });
    return { success: true };
  },
});
