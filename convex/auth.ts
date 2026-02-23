// convex/auth.ts - Role-Based Access Control utilities
import { v } from "convex/values";
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
    };
  },
});

/**
 * Get audit logs for a tournament (admin only)
 */
export const getAuditLogs = query({
  args: {
    tournamentId: v.optional(v.id("tournaments")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.role !== "admin") {
      return [];
    }

    let query = ctx.db.query("auditLogs").order("desc");

    if (args.tournamentId) {
      query = ctx.db
        .query("auditLogs")
        .withIndex("by_tournament", (q) =>
          q.eq("tournamentId", args.tournamentId),
        )
        .order("desc");
    }

    const logs = await query.take(args.limit || 50);
    return logs;
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
