// convex/members.ts - Team owners: invite links, claiming, and membership
import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { getCurrentUser, logAdminAction, requireAdmin } from "./auth";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Hex SHA-256 of an invite token. Only this hash is ever stored. */
async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 32 random bytes as base64url — safe to put in a URL path. */
function generateInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** The signed-in user's row, created on first use (like auth:ensureUser). */
async function getOrCreateUser(ctx: MutationCtx): Promise<Doc<"users">> {
  const existing = await getCurrentUser(ctx);
  if (existing) return existing;

  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) throw new Error("Not authenticated");
  const userId = await ctx.db.insert("users", {
    email: identity.email,
    name: identity.name,
    role: "user",
    createdAt: Date.now(),
  });
  return (await ctx.db.get(userId))!;
}

/** Create a one-time owner invite for a team (admin only). Valid for 7 days. */
export const createInvite = mutation({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found");

    const token = generateInviteToken();
    const expiresAt = Date.now() + INVITE_TTL_MS;
    const inviteId = await ctx.db.insert("teamInvites", {
      teamId: team._id,
      tournamentId: team.tournamentId,
      tokenHash: await hashInviteToken(token),
      expiresAt,
      createdBy: admin._id,
    });

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "create_owner_invite",
      targetType: "team",
      targetId: team._id,
      newData: { inviteId, expiresAt },
      tournamentId: team.tournamentId,
    });

    // The plaintext token leaves the server exactly once, here.
    return { token, inviteId, expiresAt };
  },
});

/** Claim an invite link: links the signed-in user to the team as an owner. */
export const claimInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await getOrCreateUser(ctx);

    const tokenHash = await hashInviteToken(args.token);
    const invite = await ctx.db
      .query("teamInvites")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!invite) {
      return { success: false as const, reason: "This invite link is not valid" };
    }

    const team = await ctx.db.get(invite.teamId);
    if (!team) {
      return { success: false as const, reason: "This team no longer exists" };
    }

    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const inTournament = memberships.find(
      (m) => m.tournamentId === invite.tournamentId,
    );

    const auctionRoom = await ctx.db
      .query("auctionRooms")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", invite.tournamentId),
      )
      .first();
    const joined = {
      success: true as const,
      teamId: team._id,
      teamName: team.name,
      tournamentId: team.tournamentId,
      auctionRoomId: auctionRoom?._id ?? null,
    };

    // Re-opening your own link (e.g. a second tap) is harmless.
    if (invite.usedBy === user._id && inTournament?.teamId === team._id) {
      return joined;
    }
    if (invite.revokedAt !== undefined) {
      return { success: false as const, reason: "This invite was revoked" };
    }
    if (invite.usedBy !== undefined) {
      return { success: false as const, reason: "This invite was already used" };
    }
    if (invite.expiresAt <= Date.now()) {
      return { success: false as const, reason: "This invite has expired" };
    }
    if (inTournament) {
      return {
        success: false as const,
        reason:
          inTournament.teamId === team._id
            ? "You are already an owner of this team"
            : "You already belong to another team in this tournament",
      };
    }

    const now = Date.now();
    await Promise.all([
      ctx.db.insert("teamMembers", {
        teamId: team._id,
        tournamentId: team.tournamentId,
        userId: user._id,
        role: "owner",
        createdAt: now,
      }),
      ctx.db.patch(invite._id, { usedBy: user._id, usedAt: now }),
    ]);

    return joined;
  },
});

/**
 * Members and open invites for a team (admin only). Returns null for anyone
 * else, so the TeamCard can render nothing rather than error.
 */
export const listMembers = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.role !== "admin") return null;

    const [members, invites] = await Promise.all([
      ctx.db
        .query("teamMembers")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .collect(),
      ctx.db
        .query("teamInvites")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .collect(),
    ]);

    const users = await Promise.all(members.map((m) => ctx.db.get(m.userId)));
    const now = Date.now();

    return {
      members: members.map((m, i) => ({
        _id: m._id,
        role: m.role,
        createdAt: m.createdAt,
        email: users[i]?.email ?? "",
        name: users[i]?.name,
      })),
      invites: invites
        .filter(
          (inv) =>
            inv.usedBy === undefined &&
            inv.revokedAt === undefined &&
            inv.expiresAt > now,
        )
        .map((inv) => ({ _id: inv._id, expiresAt: inv.expiresAt })),
    };
  },
});

/** Remove an owner from their team. Their pending raises are rejected. */
export const removeMember = mutation({
  args: { memberId: v.id("teamMembers") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const member = await ctx.db.get(args.memberId);
    if (!member) throw new Error("Member not found");

    const pending = (
      await ctx.db
        .query("bidRequests")
        .withIndex("by_team", (q) => q.eq("teamId", member.teamId))
        .collect()
    ).filter((r) => r.userId === member.userId && r.status === "pending");

    await Promise.all([
      ctx.db.delete(member._id),
      ...pending.map((r) =>
        ctx.db.patch(r._id, { status: "rejected", reason: "Owner removed" }),
      ),
      logAdminAction(ctx, {
        userId: admin._id,
        userEmail: admin.email,
        action: "remove_team_member",
        targetType: "team",
        targetId: member.teamId,
        previousData: { userId: member.userId, role: member.role },
        tournamentId: member.tournamentId,
      }),
    ]);

    return { success: true };
  },
});

/** Revoke an unused invite link. */
export const revokeInvite = mutation({
  args: { inviteId: v.id("teamInvites") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const invite = await ctx.db.get(args.inviteId);
    if (!invite) throw new Error("Invite not found");
    if (invite.usedBy !== undefined) {
      return { success: false, reason: "Invite was already used — remove the member instead" };
    }

    await Promise.all([
      ctx.db.patch(invite._id, { revokedAt: Date.now() }),
      logAdminAction(ctx, {
        userId: admin._id,
        userEmail: admin.email,
        action: "revoke_owner_invite",
        targetType: "team",
        targetId: invite.teamId,
        previousData: { inviteId: invite._id },
        tournamentId: invite.tournamentId,
      }),
    ]);

    return { success: true };
  },
});

/** Delete every owner-bidding row for a team (used by teams:deleteTeam). */
export async function deleteTeamMembershipData(
  ctx: MutationCtx,
  teamId: Id<"teams">,
) {
  const [members, invites, requests] = await Promise.all([
    ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .collect(),
    ctx.db
      .query("teamInvites")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .collect(),
    ctx.db
      .query("bidRequests")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .collect(),
  ]);
  await Promise.all(
    [...members, ...invites, ...requests].map((doc) => ctx.db.delete(doc._id)),
  );
}
