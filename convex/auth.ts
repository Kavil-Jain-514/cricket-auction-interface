// convex/auth.ts - Role-Based Access Control utilities
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { canCreateTournament, intentOf } from "./policy";

export type UserRole = "admin" | "user";

// ═══════════════════════════════════════════════════════════════════════════
// CORE AUTH HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** The signed-in person's row, deactivated or not. Most code wants getCurrentUser. */
export async function getUserRow(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", identity.email!))
    .first();
}

export const DEACTIVATED_MESSAGE = "This account has been deactivated. Contact Bid11Pro support if you think this is a mistake.";

/**
 * The current user, or null when signed out or deactivated: a deactivated
 * account counts as nobody, so it has no access anywhere.
 */
export async function getCurrentUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const user = await getUserRow(ctx);
  return user && user.deactivatedAt === undefined ? user : null;
}

/**
 * The current user, or throw: "Not authenticated", or the deactivated
 * message for a deactivated account.
 */
export async function requireUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const user = await getUserRow(ctx);
  if (!user) throw new Error("Not authenticated");
  if (user.deactivatedAt !== undefined) throw new Error(DEACTIVATED_MESSAGE);
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
    const user = await getUserRow(ctx);
    if (!user) return null;
    if (user.deactivatedAt !== undefined) {
      return {
        _id: user._id,
        email: user.email,
        name: user.name,
        role: "user" as const,
        isAdmin: false,
        accountType: undefined,
        canCreateTournament: false,
        isDeactivated: true,
      };
    }

    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      role: getUserRole(user),
      isAdmin: user.role === "admin",
      accountType: intentOf(user) ?? undefined,
      // For showing or hiding create controls; tournaments.create re-checks.
      canCreateTournament: canCreateTournament(user),
      isDeactivated: false,
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

const intentValidator = v.union(v.literal("organiser"), v.literal("team_owner"), v.literal("visitor"));

/**
 * The super-admin's user list, newest first, one page at a time. `filter`:
 * an intent, "none" (non-admins who haven't chosen since organisers existed), "admin" or
 * "deactivated". `search` matches the start of the email (by_email index).
 * Anyone else gets an empty page.
 */
export const listUsers = query({
  args: {
    filter: v.optional(
      v.union(intentValidator, v.literal("none"), v.literal("admin"), v.literal("deactivated")),
    ),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const caller = await getCurrentUser(ctx);
    if (!caller || caller.role !== "admin") return { page: [], isDone: true, continueCursor: "" };

    const search = args.search?.trim().toLowerCase();
    const filter = args.filter;
    const intent = filter === "organiser" || filter === "team_owner" || filter === "visitor" ? filter : undefined;
    const base = search
      ? ctx.db.query("users").withIndex("by_email", (q) => q.gte("email", search).lt("email", `${search}\uffff`))
      : intent
        ? ctx.db.query("users").withIndex("by_accountType", (q) => q.eq("accountType", intent))
        : ctx.db.query("users");
    const result = await base
      .order("desc")
      .filter((q) =>
        q.and(
          intent ? q.and(q.eq(q.field("accountType"), intent), q.neq(q.field("accountTypeChosenAt"), undefined)) : true,
          // Admins are never asked, so they aren't "none".
          filter === "none" ? q.and(q.eq(q.field("accountTypeChosenAt"), undefined), q.neq(q.field("role"), "admin")) : true,
          filter === "admin" ? q.eq(q.field("role"), "admin") : true,
          filter === "deactivated" ? q.neq(q.field("deactivatedAt"), undefined) : true,
        ),
      )
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map(async (u) => ({
        _id: u._id,
        email: u.email,
        name: u.name,
        role: getUserRole(u),
        intent: intentOf(u),
        deactivated: u.deactivatedAt !== undefined,
        createdAt: u.createdAt,
        tournaments: (await ctx.db.query("tournamentStaff").withIndex("by_user", (q) => q.eq("userId", u._id)).take(100)).length,
      })),
    );
    return { ...result, page };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PEOPLE DIRECTORY (super-admin)
// ═══════════════════════════════════════════════════════════════════════════
// Who organises a tournament and who owns, asked for, or was invited to own
// its teams. Names and emails are personal data: super-admin only
// (requireAdmin), read with indexed per-tournament queries, never logged.

export type TeamOwnerStatus = "joined" | "requested" | "invited";

export type TournamentPeople = {
  organisers: Array<{ userId: Id<"users">; name?: string; email: string; role: Doc<"tournamentStaff">["role"] }>;
  teamOwners: Array<{ key: string; name?: string; email: string; teamName?: string; status: TeamOwnerStatus }>;
};

const emailKey = (email: string) => email.trim().toLowerCase();

/**
 * Organisers (owners first, then auctioneers), then team owners: joined,
 * awaiting the organiser's approval, and invited but not yet joined (open
 * team links and "add your team" emails, once per address).
 */
export const tournamentPeople = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, { tournamentId }): Promise<TournamentPeople> => {
    await requireAdmin(ctx);

    const [staff, teams, members, invites, emails, requests] = await Promise.all([
      ctx.db.query("tournamentStaff").withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)).collect(),
      ctx.db.query("teams").withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)).collect(),
      ctx.db.query("teamMembers").withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)).collect(),
      ctx.db.query("teamInvites").withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)).collect(),
      ctx.db.query("emails").withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)).collect(),
      ctx.db.query("teamRequests").withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)).collect(),
    ]);
    const owners = members.filter((m) => m.role === "owner");
    const pendingRequests = requests.filter((r) => r.status === "pending");

    const userIds = [...new Set([...staff, ...owners, ...pendingRequests].map((row) => row.userId))];
    const users = new Map<Id<"users">, Doc<"users">>();
    for (const user of await Promise.all(userIds.map((id) => ctx.db.get(id)))) {
      if (user) users.set(user._id, user);
    }
    const teamNames = new Map(teams.map((t) => [t._id, t.name]));

    const organisers = [...staff]
      .sort((a, b) => Number(a.role === "auctioneer") - Number(b.role === "auctioneer"))
      .map((row) => ({
        userId: row.userId,
        name: users.get(row.userId)?.name,
        email: users.get(row.userId)?.email ?? "(deleted user)",
        role: row.role,
      }));

    const teamOwners: TournamentPeople["teamOwners"] = [
      ...owners.map((m) => ({
        key: m._id,
        name: users.get(m.userId)?.name,
        email: users.get(m.userId)?.email ?? "(deleted user)",
        teamName: teamNames.get(m.teamId),
        status: "joined" as const,
      })),
      ...pendingRequests.map((r) => ({
        key: r._id,
        name: users.get(r.userId)?.name,
        email: users.get(r.userId)?.email ?? "(deleted user)",
        teamName: r.name,
        status: "requested" as const,
      })),
    ];

    // Invited and not joined yet: each address once, and never someone listed above.
    const listed = new Set(teamOwners.map((p) => emailKey(p.email)));
    const now = Date.now();
    const invited = [
      ...invites
        .filter((inv) => inv.email && inv.usedBy === undefined && inv.revokedAt === undefined && inv.expiresAt > now)
        .map((inv) => ({ key: inv._id as string, email: inv.email!, teamName: teamNames.get(inv.teamId) })),
      ...emails
        .filter((e) => e.kind === "team_signup_invite")
        .map((e) => ({ key: e._id as string, email: e.to, teamName: undefined })),
    ];
    for (const inv of invited) {
      if (listed.has(emailKey(inv.email))) continue;
      listed.add(emailKey(inv.email));
      teamOwners.push({ ...inv, status: "invited" });
    }

    return { organisers, teamOwners };
  },
});

/** The super-admin sets someone's intent (e.g. makes a viewer an organiser). */
export const setUserIntent = mutation({
  args: { userId: v.id("users"), accountType: intentValidator },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    const previous = intentOf(target);
    await ctx.db.patch(args.userId, { accountType: args.accountType, accountTypeChosenAt: Date.now() });
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "set_user_intent",
      targetType: "user",
      targetId: args.userId,
      previousData: { accountType: previous },
      newData: { accountType: args.accountType },
    });
    return { success: true };
  },
});

/**
 * Deactivate or reactivate an account (super-admin only). A deactivated
 * account keeps its rows but can't sign in to anything (requireUser). Never
 * yourself, never another admin (remove the role first).
 */
export const setUserActive = mutation({
  args: { userId: v.id("users"), active: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    if (!args.active) {
      if (target._id === admin._id) throw new Error("You can't deactivate yourself");
      if (target.role === "admin") throw new Error("Remove their admin role first");
    }
    if ((target.deactivatedAt === undefined) === args.active) return { success: true };
    await ctx.db.patch(args.userId, { deactivatedAt: args.active ? undefined : Date.now() });
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: args.active ? "reactivate_user" : "deactivate_user",
      targetType: "user",
      targetId: args.userId,
      newData: { email: target.email },
    });
    return { success: true };
  },
});

/**
 * The caller says how they use Bid11Pro (asked once after sign-up). Only
 * these three values are accepted; the super-admin role is never chosen here.
 * Organisers can create tournaments; team owners can request a team.
 */
export const setAccountType = mutation({
  args: {
    accountType: v.union(v.literal("organiser"), v.literal("team_owner"), v.literal("visitor")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { accountType: args.accountType, accountTypeChosenAt: Date.now() });
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
