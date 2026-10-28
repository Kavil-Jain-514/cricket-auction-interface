// convex/staff.ts - Who may run each tournament (organiser isolation).
// Owners manage their tournament's staff; the platform super-admin
// (users.role "admin") passes every check. See requireTournamentRole.
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser, logAdminAction, OWNER_ONLY, requireTournamentRole } from "./auth";

const staffRole = v.union(v.literal("owner"), v.literal("auctioneer"));

/** The tournament's staff with each user's email and name. Owners only. */
export const list = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);
    const rows = await ctx.db
      .query("tournamentStaff")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();
    const me = await getCurrentUser(ctx);
    return await Promise.all(
      rows.map(async (row) => {
        const user = await ctx.db.get(row.userId);
        return {
          _id: row._id,
          role: row.role,
          userId: row.userId,
          email: user?.email ?? "(deleted user)",
          name: user?.name,
          isMe: row.userId === me?._id,
        };
      }),
    );
  },
});

/**
 * Give an existing user (they must have signed in once) a role on this
 * tournament. Owners only.
 */
export const add = mutation({
  args: { tournamentId: v.id("tournaments"), email: v.string(), role: staffRole },
  handler: async (ctx, args) => {
    const owner = await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);
    const email = args.email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!user) {
      throw new Error(`No account for ${email}. Ask them to sign in to Bid11Pro once, then add them.`);
    }
    const existing = await ctx.db
      .query("tournamentStaff")
      .withIndex("by_tournament_user", (q) => q.eq("tournamentId", args.tournamentId).eq("userId", user._id))
      .first();
    if (existing) throw new Error(`${email} is already ${existing.role === "owner" ? "an owner" : "an auctioneer"} here`);

    const staffId = await ctx.db.insert("tournamentStaff", {
      tournamentId: args.tournamentId,
      userId: user._id,
      role: args.role,
      createdAt: Date.now(),
    });
    await logAdminAction(ctx, {
      userId: owner._id,
      userEmail: owner.email,
      action: "add_tournament_staff",
      targetType: "user",
      targetId: user._id,
      newData: { email, role: args.role },
      tournamentId: args.tournamentId,
    });
    return staffId;
  },
});

/** Remove someone from a tournament's staff. Owners only; never the last owner. */
export const remove = mutation({
  args: { staffId: v.id("tournamentStaff") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.staffId);
    if (!row) throw new Error("Staff member not found");
    const owner = await requireTournamentRole(ctx, row.tournamentId, OWNER_ONLY);

    if (row.role === "owner") {
      const owners = (
        await ctx.db
          .query("tournamentStaff")
          .withIndex("by_tournament", (q) => q.eq("tournamentId", row.tournamentId))
          .collect()
      ).filter((s) => s.role === "owner");
      if (owners.length <= 1) {
        throw new Error("This is the tournament's last owner. Add another owner first.");
      }
    }

    await ctx.db.delete(args.staffId);
    const user = await ctx.db.get(row.userId);
    await logAdminAction(ctx, {
      userId: owner._id,
      userEmail: owner.email,
      action: "remove_tournament_staff",
      targetType: "user",
      targetId: row.userId,
      previousData: { email: user?.email, role: row.role },
      tournamentId: row.tournamentId,
    });
    return { success: true };
  },
});

/**
 * One-off migration for organiser isolation: make every existing
 * tournament's creator its owner. Idempotent; run once after deploying:
 *   npx convex run staff:backfillTournamentOwners
 */
export const backfillTournamentOwners = internalMutation({
  args: {},
  handler: async (ctx) => {
    let added = 0;
    for (const tournament of await ctx.db.query("tournaments").collect()) {
      const existing = await ctx.db
        .query("tournamentStaff")
        .withIndex("by_tournament_user", (q) =>
          q.eq("tournamentId", tournament._id).eq("userId", tournament.createdBy),
        )
        .first();
      if (existing) continue;
      await ctx.db.insert("tournamentStaff", {
        tournamentId: tournament._id,
        userId: tournament.createdBy,
        role: "owner",
        createdAt: Date.now(),
      });
      added++;
    }
    return { added };
  },
});
