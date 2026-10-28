// convex/payments.ts - Razorpay plan upgrades.
// Flow: app/api/payments/order creates a Razorpay order and records it here
// (recordOrder, as the owner); the customer pays in Razorpay Checkout;
// Razorpay calls convex/http.ts, which verifies the signature and calls
// applyRazorpayPayment. The plan only changes from that signed webhook.
import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { logAdminAction, OWNER_ONLY, requireTournamentRole } from "./auth";
import { PLAN_TIERS, upgradePrice } from "./planTiers";
import { planTierValidator } from "./ruleValidators";

/** Record a Razorpay order the owner is about to pay. Owners only. */
export const recordOrder = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    tier: planTierValidator,
    razorpayOrderId: v.string(),
    amount: v.number(), // paise
  },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) throw new Error("Tournament not found");
    const owner = await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);

    if (!tournament.plan) throw new Error("This tournament predates plans and has no limits; no upgrade needed");
    const expected = upgradePrice(tournament.plan.tier, args.tier);
    if (expected === null) throw new Error(`${PLAN_TIERS[args.tier].label} is not an upgrade from ${PLAN_TIERS[tournament.plan.tier].label}`);
    if (args.amount !== expected) throw new Error(`Wrong amount: expected ${expected} paise`);

    const existing = await ctx.db
      .query("paymentOrders")
      .withIndex("by_order", (q) => q.eq("razorpayOrderId", args.razorpayOrderId))
      .first();
    if (existing) throw new Error("That order is already recorded");

    return await ctx.db.insert("paymentOrders", {
      tournamentId: args.tournamentId,
      tier: args.tier,
      amount: args.amount,
      razorpayOrderId: args.razorpayOrderId,
      status: "created",
      createdBy: owner._id,
      createdAt: Date.now(),
    });
  },
});

/**
 * Apply a verified Razorpay "order.paid". Idempotent: a replay (same order
 * already paid) changes nothing. A payment that doesn't match the recorded
 * order (amount, tournament) is ignored and reported, never applied.
 */
export const applyRazorpayPayment = internalMutation({
  args: {
    razorpayOrderId: v.string(),
    paymentId: v.string(),
    amount: v.number(),
    notesTournamentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query("paymentOrders")
      .withIndex("by_order", (q) => q.eq("razorpayOrderId", args.razorpayOrderId))
      .first();
    if (!order) return { applied: false, reason: "unknown order" };
    if (order.status === "paid") return { applied: false, reason: "already paid" };
    if (order.amount !== args.amount) return { applied: false, reason: "amount mismatch" };
    if (args.notesTournamentId !== undefined && args.notesTournamentId !== order.tournamentId) {
      return { applied: false, reason: "tournament mismatch" };
    }

    const tournament = await ctx.db.get(order.tournamentId);
    if (!tournament) return { applied: false, reason: "tournament deleted" };

    const now = Date.now();
    const { maxTeams, maxPlayers } = PLAN_TIERS[order.tier];
    const plan = { tier: order.tier, maxTeams, maxPlayers, paidAt: now, paymentRef: args.paymentId };
    await ctx.db.patch(order._id, { status: "paid", paymentRef: args.paymentId, paidAt: now });
    await ctx.db.patch(order.tournamentId, { plan, updatedAt: now });

    const buyer = await ctx.db.get(order.createdBy);
    await logAdminAction(ctx, {
      userId: order.createdBy,
      userEmail: buyer?.email ?? "unknown",
      action: "plan_payment",
      targetType: "tournament",
      targetId: order.tournamentId,
      previousData: { plan: tournament.plan },
      newData: { plan, razorpayOrderId: args.razorpayOrderId, amount: args.amount },
      tournamentId: order.tournamentId,
    });
    return { applied: true };
  },
});
