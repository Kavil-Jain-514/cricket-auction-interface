/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

// Discover the Convex function modules for the test runtime (see
// auctions.test.ts for why _generated must stay included).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };
const OWNER_A = { email: "owner-a@test.com", subject: "owner|a" };
const OWNER_B = { email: "owner-b@test.com", subject: "owner|b" };

interface SetupOptions {
  basePurse?: number;
  minBidIncrement?: number;
  maxPlayersPerTeam?: number;
  basePrice?: number;
  bidMode?: "admin_only" | "confirm" | "open";
}

/**
 * Seed an admin user + active tournament with two teams and a live auction room.
 * Mirrors setup() in auctions.test.ts, plus the tournament's bidMode.
 */
async function setup(
  t: ReturnType<typeof convexTest>,
  opts: SetupOptions = {},
) {
  const {
    basePurse = 1_000_000,
    minBidIncrement = 25_000,
    maxPlayersPerTeam = 3,
    basePrice = 100_000,
    bidMode,
  } = opts;

  return await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", {
      email: ADMIN_IDENTITY.email,
      role: "admin",
      createdAt: now,
    });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Test Cup",
      createdBy: adminId,
      status: "active",
      settings: {
        basePurse,
        minBidIncrement,
        bidTimerSeconds: 30,
        maxPlayersPerTeam,
        basePrice,
        bidMode,
      },
      createdAt: now,
      updatedAt: now,
    });
    const mkTeam = (name: string) =>
      ctx.db.insert("teams", {
        tournamentId,
        name,
        ownerName: "owner",
        purseRemaining: basePurse,
        purseSpent: 0,
        colorPrimary: "#111111",
        colorSecondary: "#222222",
        createdAt: now,
        updatedAt: now,
      });
    const teamA = await mkTeam("Team A");
    const teamB = await mkTeam("Team B");
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room 1",
      status: "live",
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    return { adminId, tournamentId, teamA, teamB, roomId };
  });
}

/** Insert a plain (non-admin) user for an identity. */
async function seedUser(
  t: ReturnType<typeof convexTest>,
  identity: { email: string },
) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email: identity.email,
      role: "user",
      createdAt: Date.now(),
    }),
  );
}

describe("owner invites", () => {
  test("an invite is claimed once and stores only a hash", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { teamA, tournamentId, roomId } = await setup(t);

    const { token } = await asAdmin.mutation(api.members.createInvite, {
      teamId: teamA,
    });
    expect(token.length).toBeGreaterThanOrEqual(32);

    // Only the hash is persisted — no field holds the plaintext token.
    await t.run(async (ctx) => {
      const invites = await ctx.db.query("teamInvites").collect();
      expect(invites).toHaveLength(1);
      expect(invites[0].tokenHash).not.toBe(token);
      expect(JSON.stringify(invites[0])).not.toContain(token);
    });

    const claimA = await t
      .withIdentity(OWNER_A)
      .mutation(api.members.claimInvite, { token });
    expect(claimA).toMatchObject({
      success: true,
      teamId: teamA,
      tournamentId,
      auctionRoomId: roomId,
    });

    // claimInvite creates the user row when the owner has never signed in.
    await t.run(async (ctx) => {
      const members = await ctx.db
        .query("teamMembers")
        .withIndex("by_team", (q) => q.eq("teamId", teamA))
        .collect();
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe("owner");
      const user = await ctx.db.get(members[0].userId);
      expect(user?.email).toBe(OWNER_A.email);
      expect(user?.role).toBe("user");
    });

    // Single use: a second person cannot reuse the link.
    const claimB = await t
      .withIdentity(OWNER_B)
      .mutation(api.members.claimInvite, { token });
    expect(claimB).toMatchObject({ success: false });
  });

  test("an expired invite cannot be claimed", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { teamA } = await setup(t);

    const { token } = await asAdmin.mutation(api.members.createInvite, {
      teamId: teamA,
    });
    await t.run(async (ctx) => {
      const invite = (await ctx.db.query("teamInvites").first())!;
      // Created with a 7-day expiry.
      expect(invite.expiresAt - Date.now()).toBeGreaterThan(6 * 86_400_000);
      await ctx.db.patch(invite._id, { expiresAt: Date.now() - 1 });
    });

    const res = await t
      .withIdentity(OWNER_A)
      .mutation(api.members.claimInvite, { token });
    expect(res).toMatchObject({ success: false, reason: expect.stringMatching(/expired/i) });
  });

  test("a revoked invite cannot be claimed", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { teamA } = await setup(t);

    const { token, inviteId } = await asAdmin.mutation(
      api.members.createInvite,
      { teamId: teamA },
    );
    await asAdmin.mutation(api.members.revokeInvite, { inviteId });

    const res = await t
      .withIdentity(OWNER_A)
      .mutation(api.members.claimInvite, { token });
    expect(res).toMatchObject({ success: false });
  });

  test("an unknown token is rejected", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const res = await t
      .withIdentity(OWNER_A)
      .mutation(api.members.claimInvite, { token: "not-a-real-token" });
    expect(res).toMatchObject({ success: false });
  });

  test("an owner cannot join a second team in the same tournament", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { teamA, teamB } = await setup(t);
    const asOwner = t.withIdentity(OWNER_A);

    const inviteA = await asAdmin.mutation(api.members.createInvite, { teamId: teamA });
    const inviteB = await asAdmin.mutation(api.members.createInvite, { teamId: teamB });
    expect(await asOwner.mutation(api.members.claimInvite, { token: inviteA.token }))
      .toMatchObject({ success: true });

    const second = await asOwner.mutation(api.members.claimInvite, {
      token: inviteB.token,
    });
    expect(second).toMatchObject({ success: false });

    // The rejected invite stays usable for the right person.
    await t.run(async (ctx) => {
      const invite = await ctx.db.get(inviteB.inviteId);
      expect(invite?.usedBy).toBeUndefined();
    });
  });

  test("non-admins cannot create invites or list members", async () => {
    const t = convexTest(schema, modules);
    const { teamA } = await setup(t);
    await seedUser(t, OWNER_A);
    const asOwner = t.withIdentity(OWNER_A);

    await expect(
      asOwner.mutation(api.members.createInvite, { teamId: teamA }),
    ).rejects.toThrow(/admin/i);
    expect(
      await asOwner.query(api.members.listMembers, { teamId: teamA }),
    ).toBeNull();
  });

  test("listMembers shows owners and open invites; removeMember revokes access", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { teamA } = await setup(t);

    const claimed = await asAdmin.mutation(api.members.createInvite, { teamId: teamA });
    await t.withIdentity(OWNER_A).mutation(api.members.claimInvite, {
      token: claimed.token,
    });
    await asAdmin.mutation(api.members.createInvite, { teamId: teamA });

    const listing = await asAdmin.query(api.members.listMembers, { teamId: teamA });
    expect(listing!.members).toHaveLength(1);
    expect(listing!.members[0].email).toBe(OWNER_A.email);
    // The claimed invite is no longer "open"; only the fresh one is listed.
    expect(listing!.invites).toHaveLength(1);

    await asAdmin.mutation(api.members.removeMember, {
      memberId: listing!.members[0]._id,
    });
    const after = await asAdmin.query(api.members.listMembers, { teamId: teamA });
    expect(after!.members).toHaveLength(0);

    // Invite, removal and revocation are all audit-logged.
    await t.run(async (ctx) => {
      const actions = (await ctx.db.query("auditLogs").collect()).map((l) => l.action);
      expect(actions).toContain("create_owner_invite");
      expect(actions).toContain("remove_team_member");
    });
  });

  test("removing an owner rejects their pending raises", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { teamA, tournamentId, roomId } = await setup(t);

    const { token } = await asAdmin.mutation(api.members.createInvite, { teamId: teamA });
    await t.withIdentity(OWNER_A).mutation(api.members.claimInvite, { token });

    const requestId = await t.run(async (ctx) => {
      const member = (await ctx.db.query("teamMembers").first())!;
      const playerId = await ctx.db.insert("players", {
        tournamentId,
        name: "Virat",
        age: 30,
        role: "Batter",
        battingBowlingHand: "Right-handed",
        auctionStatus: "in_auction",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return await ctx.db.insert("bidRequests", {
        auctionRoomId: roomId,
        playerId,
        teamId: teamA,
        userId: member.userId,
        amount: 100_000,
        status: "pending",
        createdAt: Date.now(),
      });
    });

    const listing = await asAdmin.query(api.members.listMembers, { teamId: teamA });
    await asAdmin.mutation(api.members.removeMember, {
      memberId: listing!.members[0]._id,
    });

    const request = await t.run((ctx) => ctx.db.get(requestId as Id<"bidRequests">));
    expect(request?.status).toBe("rejected");
    expect(request?.reason).toMatch(/removed/i);
  });
});
