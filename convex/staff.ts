// convex/staff.ts - Who may run each tournament (organiser isolation).
// Owners manage their tournament's staff: owners, auctioneers and
// registration admins ("registrar"), invited by email whether or not they
// have an account yet. The platform super-admin (users.role "admin") passes
// every check. See requireTournamentRole.
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getCurrentUser, logAdminAction, OWNER_ONLY, requireTournamentRole } from "./auth";
import { consumeInviteEmailQuota, enqueueEmail } from "./emails";
import { consumeRateLimit } from "./rateLimit";
import { normalizeEmail } from "./validation";
import { staffRoleValidator } from "./staffRoles";

// Address lookups per owner per hour: plenty for staffing a tournament, too
// few to probe which addresses have accounts (AUDIT 2026-11 SEC-005).
const STAFF_LOOKUP_LIMIT = { limit: 60, windowMs: 60 * 60 * 1000 };

const staffRole = staffRoleValidator;

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

/** "an owner", "an auctioneer", "a registration admin": for messages. */
export const STAFF_ROLE_PHRASE: Record<Doc<"tournamentStaff">["role"], string> = {
  owner: "an owner",
  auctioneer: "an auctioneer",
  registrar: "a registration admin",
};

/**
 * Offer someone a role on this tournament by email. They needn't have an
 * account: the invite is claimed by their first sign-in with this address
 * (claimStaffInvites, from auth:ensureUser), or their next visit if they
 * already have one. Every address gets the same answer, so this can't be
 * used to learn who has an account (AUDIT 2026-11 SEC-005). Owners only.
 */
export const add = mutation({
  args: { tournamentId: v.id("tournaments"), email: v.string(), role: staffRole },
  handler: async (ctx, args) => {
    const owner = await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);
    const email = normalizeEmail(args.email);
    if (!email) throw new ConvexError("Enter a valid email address, like name@example.com.");
    if (!(await consumeRateLimit(ctx, `staff-lookup:${owner._id}`, STAFF_LOOKUP_LIMIT))) {
      throw new ConvexError("Too many staff changes in the last hour. Try again later.");
    }
    // Already on the staff: the owner can see that in the list anyway.
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    const existing = user
      ? await ctx.db
          .query("tournamentStaff")
          .withIndex("by_tournament_user", (q) => q.eq("tournamentId", args.tournamentId).eq("userId", user._id))
          .first()
      : null;
    if (existing) throw new ConvexError(`${email} is already ${STAFF_ROLE_PHRASE[existing.role]} here.`);
    const pending = (await pendingInvites(ctx, email)).find((i) => i.tournamentId === args.tournamentId);
    if (pending) {
      throw new ConvexError(`${email} is already invited as ${STAFF_ROLE_PHRASE[pending.role]}. Remove that invite first to change the role.`);
    }

    // Counts against the same hourly cap as the other invite emails, so an
    // invite/revoke loop can't be used to mail someone repeatedly.
    await consumeInviteEmailQuota(ctx, owner._id);
    const inviteId = await ctx.db.insert("staffInvites", {
      tournamentId: args.tournamentId,
      email,
      role: args.role,
      invitedBy: owner._id,
      createdAt: Date.now(),
    });
    const tournament = await ctx.db.get(args.tournamentId);
    await enqueueEmail(ctx, {
      kind: "staff_added",
      dedupeKey: `staff-invite:${inviteId}`,
      tournamentId: args.tournamentId,
      to: email,
      replyTo: owner.email,
      payload: {
        tournamentId: args.tournamentId,
        tournamentName: tournament?.name ?? "a tournament",
        inviterName: owner.name || owner.email,
        inviteeName: user?.name,
        role: args.role,
      },
    });
    await logAdminAction(ctx, {
      userId: owner._id,
      userEmail: owner.email,
      action: "invite_tournament_staff",
      targetType: "staffInvite",
      targetId: inviteId,
      newData: { email, role: args.role },
      tournamentId: args.tournamentId,
    });
    return { status: "invited" as const, inviteId };
  },
});

/** Invites to this address that nobody has claimed or revoked. */
async function pendingInvites(ctx: QueryCtx | MutationCtx, email: string): Promise<Doc<"staffInvites">[]> {
  const rows = await ctx.db
    .query("staffInvites")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
  return rows.filter((i) => i.claimedAt === undefined && i.revokedAt === undefined);
}

/**
 * Turn the signed-in user's pending invites into staff roles. Called by
 * auth:ensureUser on every app load, so it is idempotent and cheap when
 * there is nothing to claim (one indexed read). The email is the one the
 * sign-in provider verified.
 */
export async function claimStaffInvites(ctx: MutationCtx, user: Doc<"users">): Promise<number> {
  const email = normalizeEmail(user.email);
  if (!email) return 0;
  let claimed = 0;
  for (const invite of await pendingInvites(ctx, email)) {
    const now = Date.now();
    const already = await ctx.db
      .query("tournamentStaff")
      .withIndex("by_tournament_user", (q) => q.eq("tournamentId", invite.tournamentId).eq("userId", user._id))
      .first();
    if (!already) {
      await ctx.db.insert("tournamentStaff", {
        tournamentId: invite.tournamentId,
        userId: user._id,
        role: invite.role,
        createdAt: now,
      });
      claimed++;
    }
    await ctx.db.patch(invite._id, { claimedAt: now, claimedBy: user._id });
    await logAdminAction(ctx, {
      userId: user._id,
      userEmail: user.email,
      action: "claim_staff_invite",
      targetType: "staffInvite",
      targetId: invite._id,
      newData: { role: invite.role, alreadyStaff: already?.role },
      tournamentId: invite.tournamentId,
    });
  }
  return claimed;
}

/** Invites waiting for their first sign-in. Owners only. */
export const listInvites = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);
    const rows = await ctx.db
      .query("staffInvites")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();
    return rows
      .filter((i) => i.claimedAt === undefined && i.revokedAt === undefined)
      .map((i) => ({ _id: i._id, email: i.email, role: i.role, createdAt: i.createdAt }));
  },
});

/** Withdraw an invite nobody has claimed yet. Owners only. */
export const revokeInvite = mutation({
  args: { inviteId: v.id("staffInvites") },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) throw new ConvexError("Invite not found");
    const owner = await requireTournamentRole(ctx, invite.tournamentId, OWNER_ONLY);
    if (invite.claimedAt !== undefined) {
      throw new ConvexError(`${invite.email} has already joined. Remove them from the staff list instead.`);
    }
    if (invite.revokedAt !== undefined) return { success: true };
    await ctx.db.patch(args.inviteId, { revokedAt: Date.now() });
    await logAdminAction(ctx, {
      userId: owner._id,
      userEmail: owner.email,
      action: "revoke_staff_invite",
      targetType: "staffInvite",
      targetId: args.inviteId,
      previousData: { email: invite.email, role: invite.role },
      tournamentId: invite.tournamentId,
    });
    return { success: true };
  },
});

/** Remove someone from a tournament's staff. Owners only; never the last owner. */
export const remove = mutation({
  args: { staffId: v.id("tournamentStaff") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.staffId);
    if (!row) throw new ConvexError("Staff member not found");
    const owner = await requireTournamentRole(ctx, row.tournamentId, OWNER_ONLY);

    if (row.role === "owner") {
      const owners = (
        await ctx.db
          .query("tournamentStaff")
          .withIndex("by_tournament", (q) => q.eq("tournamentId", row.tournamentId))
          .collect()
      ).filter((s) => s.role === "owner");
      if (owners.length <= 1) {
        throw new ConvexError("This is the tournament's last owner. Add another owner first.");
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
