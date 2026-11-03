// convex/auth.ts - Role-Based Access Control utilities
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

export type UserRole = "admin" | "user";

// ═══════════════════════════════════════════════════════════════════════════
// CORE AUTH HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the current authenticated user from the database
 */
export async function getCurrentUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) return null;

  const user = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", identity.email!))
    .first();

  return user;
}

/**
 * Get the current user or throw an error if not authenticated
 */
export async function requireUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new Error("Not authenticated");
  }
  return user;
}

/**
 * Check if the current user has admin role
 */
export async function isAdmin(ctx: QueryCtx | MutationCtx): Promise<boolean> {
  const user = await getCurrentUser(ctx);
  return user?.role === "admin";
}

/**
 * Require admin role or throw an error
 */
export async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    throw new Error("Admin access required");
  }
  return user;
}

/**
 * Get the user's role (defaults to 'user' if not set)
 */
export function getUserRole(user: Doc<"users"> | null): UserRole {
  if (!user) return "user";
  return user.role || "user";
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOGGING
// ═══════════════════════════════════════════════════════════════════════════

interface AuditLogParams {
  userId: Id<"users">;
  userEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  previousData?: unknown;
  newData?: unknown;
  tournamentId?: Id<"tournaments">;
  auctionRoomId?: Id<"auctionRooms">;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOURNAMENT-SCOPED ACCESS (organisers)
// ═══════════════════════════════════════════════════════════════════════════

export type TournamentRole = "owner" | "auctioneer";

/** Runs the auction on the day, including sale corrections and purse tools. */
export const RUN_AUCTION: TournamentRole[] = ["owner", "auctioneer"];
/** Settings, teams, players, staff, invites, draws, exports, restart, delete. */
export const OWNER_ONLY: TournamentRole[] = ["owner"];

/**
 * The caller's access to a tournament: "super_admin" (users.role "admin",
 * the platform operator), their tournamentStaff role, or null.
 */
export async function getTournamentRole(
  ctx: QueryCtx | MutationCtx,
  tournamentId: Id<"tournaments">,
  user?: Doc<"users"> | null,
): Promise<"super_admin" | TournamentRole | null> {
  const caller = user === undefined ? await getCurrentUser(ctx) : user;
  if (!caller) return null;
  if (caller.role === "admin") return "super_admin";
  const staff = await ctx.db
    .query("tournamentStaff")
    .withIndex("by_tournament_user", (q) =>
      q.eq("tournamentId", tournamentId).eq("userId", caller._id),
    )
    .first();
  return staff?.role ?? null;
}

/** True for a super-admin or anyone on the tournament's staff. */
export async function isTournamentStaff(
  ctx: QueryCtx | MutationCtx,
  tournamentId: Id<"tournaments">,
): Promise<boolean> {
  return (await getTournamentRole(ctx, tournamentId)) !== null;
}

/**
 * Throws unless the caller is a super-admin or holds one of `roles` on this
 * tournament. Replaces the global requireAdmin for tournament-scoped work.
 */
export async function requireTournamentRole(
  ctx: QueryCtx | MutationCtx,
  tournamentId: Id<"tournaments">,
  roles: TournamentRole[],
): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  const role = await getTournamentRole(ctx, tournamentId, user);
  if (role === "super_admin" || (role !== null && roles.includes(role))) {
    return user;
  }
  throw new Error("You don't have access to this tournament");
}

/**
 * Log an admin action to the audit log
 */
export async function logAdminAction(
  ctx: MutationCtx,
  params: AuditLogParams,
): Promise<Id<"auditLogs">> {
  return await ctx.db.insert("auditLogs", {
    userId: params.userId,
    userEmail: params.userEmail,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    previousData: params.previousData,
    newData: params.newData,
    tournamentId: params.tournamentId,
    auctionRoomId: params.auctionRoomId,
    timestamp: Date.now(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get current user with role information
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      role: getUserRole(user),
      isAdmin: user.role === "admin",
      accountType: user.accountType,
    };
  },
});

/**
 * Admin audit log, newest first, one page at a time. Filters: tournament
 * (by_tournament index), action, and a timestamp range (by_timestamp index
 * when no tournament is given). Non-admins get an empty page.
 */
export const listAuditLogs = query({
  args: {
    tournamentId: v.optional(v.id("tournaments")),
    action: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.role !== "admin") {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const { tournamentId, action, from, to } = args;
    const base = tournamentId
      ? ctx.db
          .query("auditLogs")
          .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
      : ctx.db.query("auditLogs").withIndex("by_timestamp", (q) => {
          if (from !== undefined && to !== undefined) {
            return q.gte("timestamp", from).lte("timestamp", to);
          }
          if (from !== undefined) return q.gte("timestamp", from);
          if (to !== undefined) return q.lte("timestamp", to);
          return q;
        });

    // The tournament index can't range on time, so dates filter there.
    const filterDates = tournamentId !== undefined;
    return await base
      .filter((q) =>
        q.and(
          action !== undefined ? q.eq(q.field("action"), action) : true,
          filterDates && from !== undefined ? q.gte(q.field("timestamp"), from) : true,
          filterDates && to !== undefined ? q.lte(q.field("timestamp"), to) : true,
        ),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Set a user's role (admin only)
 */
export const setUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("user")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser) throw new Error("User not found");

    // Never leave the app with no admin: the last one can't be demoted
    // (in practice, the only admin demoting themselves).
    if (targetUser.role === "admin" && args.role !== "admin") {
      const admins = (await ctx.db.query("users").collect()).filter(
        (u) => u.role === "admin",
      );
      if (admins.length <= 1) {
        throw new Error(
          "You are the last admin. Promote someone else before stepping down.",
        );
      }
    }

    const previousRole = targetUser.role;

    await ctx.db.patch(args.userId, { role: args.role });

    // Log the action
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "set_user_role",
      targetType: "user",
      targetId: args.userId,
      previousData: { role: previousRole },
      newData: { role: args.role },
    });

    return { success: true };
  },
});

/**
 * Get all users (admin only)
 */
export const getAllUsers = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.role !== "admin") {
      return [];
    }

    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({
      _id: u._id,
      email: u.email,
      name: u.name,
      role: getUserRole(u),
      createdAt: u.createdAt,
    }));
  },
});

/**
 * The caller says how they use Bid11Pro (asked once after sign-up). Team
 * owners can then request a team in a tournament (teamRequests:submit).
 */
export const setAccountType = mutation({
  args: { accountType: v.union(v.literal("team_owner"), v.literal("visitor")) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { accountType: args.accountType });
    return { success: true };
  },
});

/**
 * Ensure user exists or create them (called on sign in)
 */
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) {
      throw new Error("No email in identity");
    }

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", identity.email!))
      .first();

    if (existingUser) {
      // Update name if changed
      if (identity.name && identity.name !== existingUser.name) {
        await ctx.db.patch(existingUser._id, { name: identity.name });
      }
      return existingUser._id;
    }

    // Create new user with default 'user' role
    // First user gets admin role
    const userCount = await ctx.db.query("users").collect();
    const isFirstUser = userCount.length === 0;

    // Race condition guard: if two requests arrive simultaneously,
    // the second insert may conflict on the by_email unique index.
    // Re-check after collecting user count.
    const raceCheck = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", identity.email!))
      .first();
    if (raceCheck) {
      return raceCheck._id;
    }

    const userId = await ctx.db.insert("users", {
      email: identity.email,
      name: identity.name,
      role: isFirstUser ? "admin" : "user",
      createdAt: Date.now(),
    });

    return userId;
  },
});
