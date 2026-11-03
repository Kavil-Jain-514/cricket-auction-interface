// convex/teamRequests.ts - Teams requested by self-declared team owners.
// A signed-in user who owns a team asks for it in a tournament; one of the
// tournament's owners verifies and approves it, which creates the team
// (same rules as teams:create) and makes the requester its owner member, so
// they can bid from their paddle. Nothing is created until approval.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, logAdminAction, OWNER_ONLY, requireTournamentRole } from "./auth";
import { getOrCreateUser } from "./members";
import { canRequestTeam } from "./policy";
import { consumeInviteEmailQuota, enqueueEmail, requeueEmail } from "./emails";
import { insertValidatedTeam } from "./teams";
import { normalizeEmail, validateOwnerName, validateTeamColours, validateTeamName } from "./validation";

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Ask for a team in a tournament. Team owners only; one open request each. */
export const submit = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.string(),
    ownerName: v.string(),
    sponsorName: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    colorPrimary: v.string(),
    colorSecondary: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getOrCreateUser(ctx);
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament || tournament.isActive === false) throw new Error("Tournament not found");
    if (!canRequestTeam(user)) throw new Error('Only team owners can register a team. Choose "I own a team" on your dashboard first.');
    if (tournament.status === "completed") throw new Error("This tournament is closed");

    const error =
      validateTeamName(args.name) ??
      validateOwnerName(args.ownerName) ??
      validateTeamColours(args.colorPrimary, args.colorSecondary);
    if (error) throw new Error(error);
    if (args.logoUrl && !args.logoUrl.startsWith("https://")) throw new Error("Upload the logo with the form's upload button");

    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    if (memberships.some((m) => m.tournamentId === args.tournamentId)) {
      throw new Error("You already own a team in this tournament");
    }
    const mine = await ctx.db
      .query("teamRequests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    if (mine.some((r) => r.tournamentId === args.tournamentId && r.status === "pending")) {
      throw new Error("You already have a request waiting for this tournament");
    }
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();
    if (teams.some((t) => sameName(t.name, args.name))) {
      throw new Error(`Team "${args.name.trim()}" already exists in this tournament`);
    }

    return await ctx.db.insert("teamRequests", {
      tournamentId: args.tournamentId,
      userId: user._id,
      name: args.name.trim(),
      ownerName: args.ownerName.trim(),
      sponsorName: args.sponsorName?.trim() || undefined,
      logoUrl: args.logoUrl || undefined,
      colorPrimary: args.colorPrimary,
      colorSecondary: args.colorSecondary,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

/** The caller's requests, newest first, with each tournament's name. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("teamRequests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
    return await Promise.all(
      rows.map(async (r) => ({ ...r, tournamentName: (await ctx.db.get(r.tournamentId))?.name ?? "Tournament" })),
    );
  },
});

/** The caller's latest request for one tournament, or null. */
export const getMineForTournament = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const rows = await ctx.db
      .query("teamRequests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
    return rows.find((r) => r.tournamentId === args.tournamentId) ?? null;
  },
});

/** Owner review list, newest first, with who asked. */
export const listForTournament = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);
    const rows = await ctx.db
      .query("teamRequests")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .order("desc")
      .collect();
    return await Promise.all(
      rows.map(async (r) => {
        const requester = await ctx.db.get(r.userId);
        return { ...r, requesterEmail: requester?.email ?? "", requesterName: requester?.name };
      }),
    );
  },
});

/** Verify the owner: creates the team and links the requester as its owner. */
export const approve = mutation({
  args: { requestId: v.id("teamRequests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found");
    const admin = await requireTournamentRole(ctx, request.tournamentId, OWNER_ONLY);
    if (request.status !== "pending") throw new Error(`Already ${request.status}`);
    const tournament = await ctx.db.get(request.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userId", request.userId))
      .collect();
    if (memberships.some((m) => m.tournamentId === request.tournamentId)) {
      throw new Error("They already own a team in this tournament");
    }

    const teamId = await insertValidatedTeam(ctx, tournament, {
      name: request.name,
      ownerName: request.ownerName,
      sponsorName: request.sponsorName,
      logoUrl: request.logoUrl,
      colorPrimary: request.colorPrimary,
      colorSecondary: request.colorSecondary,
    });
    const now = Date.now();
    await ctx.db.insert("teamMembers", {
      teamId,
      tournamentId: request.tournamentId,
      userId: request.userId,
      role: "owner",
      createdAt: now,
    });
    await ctx.db.patch(request._id, { status: "approved", teamId, reviewedAt: now });
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "approve_team_request",
      targetType: "team",
      targetId: teamId,
      newData: { name: request.name, ownerName: request.ownerName, requestId: request._id, ownerUserId: request.userId },
      tournamentId: request.tournamentId,
    });
    return teamId;
  },
});

/** Turn a request down with a reason the requester sees. */
export const reject = mutation({
  args: { requestId: v.id("teamRequests"), reason: v.string() },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found");
    const admin = await requireTournamentRole(ctx, request.tournamentId, OWNER_ONLY);
    const reason = args.reason.trim();
    if (!reason) throw new Error("A reason is required");
    if (request.status !== "pending") throw new Error(`Already ${request.status}`);
    await ctx.db.patch(request._id, { status: "rejected", rejectReason: reason.slice(0, 200), reviewedAt: Date.now() });
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "reject_team_request",
      targetType: "teamRequest",
      targetId: request._id,
      newData: { name: request.name, reason },
      tournamentId: request.tournamentId,
    });
    return { success: true };
  },
});

/**
 * Invite a team owner to add their own team: emails them the tournament's
 * team sign-up link (/tournament/<id>/join-team). Owners only. The same
 * address is invited at most once a day (a failed email is sent again), and
 * every invite email counts against the organiser's hourly cap.
 */
export const inviteOwner = mutation({
  args: { tournamentId: v.id("tournaments"), email: v.string() },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) throw new Error("Tournament not found");
    const owner = await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);
    const email = normalizeEmail(args.email);
    if (!email) throw new Error("Enter a valid email address");
    if (tournament.status === "completed") throw new Error("This tournament is closed");

    const day = new Date().toISOString().slice(0, 10);
    const dedupeKey = `team-signup:${args.tournamentId}:${email}:${day}`;
    const existing = await ctx.db
      .query("emails")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (existing && existing.status !== "failed") throw new Error(`${email} was already invited today`);
    await consumeInviteEmailQuota(ctx, owner._id);
    if (existing) {
      await requeueEmail(ctx, existing._id);
    } else {
      await enqueueEmail(ctx, {
        kind: "team_signup_invite",
        dedupeKey,
        tournamentId: args.tournamentId,
        to: email,
        payload: { tournamentId: args.tournamentId, tournamentName: tournament.name, inviterName: owner.name || owner.email },
      });
    }
    await logAdminAction(ctx, {
      userId: owner._id,
      userEmail: owner.email,
      action: "invite_team_owner",
      targetType: "tournament",
      targetId: args.tournamentId,
      newData: { email },
      tournamentId: args.tournamentId,
    });
    return { success: true };
  },
});

/** "Add your team" invitations sent for a tournament, newest first, one per address. Owners only. */
export const listOwnerInvites = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);
    const rows = (
      await ctx.db
        .query("emails")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect()
    )
      .filter((r) => r.kind === "team_signup_invite")
      .sort((a, b) => b.createdAt - a.createdAt);
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.to)) latest.set(r.to, r);
    return [...latest.values()].map((r) => ({ _id: r._id, email: r.to, status: r.status, createdAt: r.createdAt }));
  },
});
