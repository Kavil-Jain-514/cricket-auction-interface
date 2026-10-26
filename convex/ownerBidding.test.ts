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

/** Link a user (created if needed) to a team as an owner. */
async function seedOwner(
  t: ReturnType<typeof convexTest>,
  args: {
    identity: { email: string };
    teamId: Id<"teams">;
    tournamentId: Id<"tournaments">;
  },
) {
  return await t.run(async (ctx) => {
    const existing = (await ctx.db.query("users").collect()).find(
      (u) => u.email === args.identity.email,
    );
    const userId =
      existing?._id ??
      (await ctx.db.insert("users", {
        email: args.identity.email,
        role: "user",
        createdAt: Date.now(),
      }));
    await ctx.db.insert("teamMembers", {
      teamId: args.teamId,
      tournamentId: args.tournamentId,
      userId,
      role: "owner",
      createdAt: Date.now(),
    });
    return userId;
  });
}

/** Insert a player and mark it as the current in-auction player for the room. */
async function putPlayerInAuction(
  t: ReturnType<typeof convexTest>,
  args: { tournamentId: Id<"tournaments">; roomId: Id<"auctionRooms"> },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const playerId = await ctx.db.insert("players", {
      tournamentId: args.tournamentId,
      name: "Virat",
      age: 30,
      role: "Batter",
      battingBowlingHand: "Right-handed",
      auctionStatus: "in_auction",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.roomId, {
      currentPlayerId: playerId,
      bidTimerEndsAt: now + 30_000,
      updatedAt: now,
    });
    return playerId;
  });
}

/** Seed a tournament in the given mode with a player up and owners on A and B. */
async function setupBidding(
  t: ReturnType<typeof convexTest>,
  opts: SetupOptions = {},
) {
  const ids = await setup(t, opts);
  const playerId = await putPlayerInAuction(t, ids);
  const ownerA = await seedOwner(t, {
    identity: OWNER_A,
    teamId: ids.teamA,
    tournamentId: ids.tournamentId,
  });
  const ownerB = await seedOwner(t, {
    identity: OWNER_B,
    teamId: ids.teamB,
    tournamentId: ids.tournamentId,
  });
  return { ...ids, playerId, ownerA, ownerB };
}

async function liveBidsFor(t: ReturnType<typeof convexTest>, playerId: Id<"players">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("liveBids").collect()).filter(
      (b) => b.playerId === playerId,
    ),
  );
}

async function requestsFor(t: ReturnType<typeof convexTest>, playerId: Id<"players">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("bidRequests").collect()).filter(
      (r) => r.playerId === playerId,
    ),
  );
}

/** The pending request a confirm-mode raise created (fails the test otherwise). */
function requestIdOf(res: object): Id<"bidRequests"> {
  if (!("requestId" in res)) {
    throw new Error(`expected a pending request, got ${JSON.stringify(res)}`);
  }
  return res.requestId as Id<"bidRequests">;
}

/** Age every bid request so the 500 ms same-team spacing no longer applies. */
async function ageRequests(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    for (const r of await ctx.db.query("bidRequests").collect()) {
      await ctx.db.patch(r._id, { createdAt: r.createdAt - 1_000 });
    }
  });
}

describe("raiseBid — who may raise", () => {
  test("a signed-in user who is not an owner cannot raise", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playerId } = await setupBidding(t, { bidMode: "open" });
    const STRANGER = { email: "stranger@test.com", subject: "x|1" };
    await seedUser(t, STRANGER);

    const res = await t
      .withIdentity(STRANGER)
      .mutation(api.auctions.raiseBid, { auctionRoomId: roomId });
    expect(res).toMatchObject({ success: false, reason: "You are not an owner in this auction" });
    expect(await liveBidsFor(t, playerId)).toHaveLength(0);
  });

  test("a signed-out caller cannot raise", async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await setupBidding(t, { bidMode: "open" });
    const res = await t.mutation(api.auctions.raiseBid, { auctionRoomId: roomId });
    expect(res).toMatchObject({ success: false });
  });

  test("an owner in another tournament cannot raise here", async () => {
    const t = convexTest(schema, modules);
    const { roomId, adminId } = await setupBidding(t, { bidMode: "open" });
    const OTHER = { email: "other-owner@test.com", subject: "o|1" };
    await t.run(async (ctx) => {
      const now = Date.now();
      const otherTournament = await ctx.db.insert("tournaments", {
        name: "Other Cup",
        createdBy: adminId,
        status: "active",
        settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 3, bidMode: "open" },
        createdAt: now,
        updatedAt: now,
      });
      const otherTeam = await ctx.db.insert("teams", {
        tournamentId: otherTournament,
        name: "Elsewhere XI",
        ownerName: "o",
        purseRemaining: 1_000_000,
        purseSpent: 0,
        colorPrimary: "#000000",
        colorSecondary: "#ffffff",
        createdAt: now,
        updatedAt: now,
      });
      const userId = await ctx.db.insert("users", { email: OTHER.email, role: "user", createdAt: now });
      await ctx.db.insert("teamMembers", {
        teamId: otherTeam,
        tournamentId: otherTournament,
        userId,
        role: "owner",
        createdAt: now,
      });
    });

    const res = await t.withIdentity(OTHER).mutation(api.auctions.raiseBid, { auctionRoomId: roomId });
    expect(res).toMatchObject({ success: false, reason: "You are not an owner in this auction" });
  });

  test("an owner's raise always lands on their own team", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playerId, teamA, ownerA } = await setupBidding(t, { bidMode: "open" });

    const res = await t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, { auctionRoomId: roomId });
    expect(res).toMatchObject({ success: true, teamId: teamA, amount: 100_000 });

    const bids = await liveBidsFor(t, playerId);
    expect(bids).toHaveLength(1);
    expect(bids[0]).toMatchObject({ teamId: teamA, source: "owner", userId: ownerA });
  });

  test("raises are refused while bidding is admin-only (including legacy tournaments)", async () => {
    for (const bidMode of [undefined, "admin_only"] as const) {
      const t = convexTest(schema, modules);
      const { roomId, playerId } = await setupBidding(t, { bidMode });
      const res = await t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, { auctionRoomId: roomId });
      expect(res).toMatchObject({ success: false, reason: "Owner bidding is off" });
      expect(await liveBidsFor(t, playerId)).toHaveLength(0);
    }
  });
});

describe("raiseBid — same rules as placeBid", () => {
  test("a raise over maxAllowedBid fails with placeBid's reason, in both modes", async () => {
    for (const bidMode of ["open", "confirm"] as const) {
      const t = convexTest(schema, modules);
      // 3-player squads at 100k base → max allowed = 1M − 2×100k = 800k.
      const { roomId, teamA, playerId } = await setupBidding(t, { bidMode });

      const asAdmin = t.withIdentity(ADMIN_IDENTITY);
      const adminRes = await asAdmin.mutation(api.auctions.placeBid, {
        auctionRoomId: roomId,
        teamId: teamA,
        amount: 900_000,
      });
      const ownerRes = await t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, {
        auctionRoomId: roomId,
        amount: 900_000,
      });

      expect(adminRes.success).toBe(false);
      expect(ownerRes).toMatchObject({ success: false, reason: adminRes.reason });
      expect(await liveBidsFor(t, playerId)).toHaveLength(0);
      expect(await requestsFor(t, playerId)).toHaveLength(0);
    }
  });

  test("a raise for a full squad fails with placeBid's reason", async () => {
    const t = convexTest(schema, modules);
    const { roomId, teamA, tournamentId } = await setupBidding(t, {
      bidMode: "open",
      maxPlayersPerTeam: 1,
    });
    await t.run((ctx) =>
      ctx.db.insert("players", {
        tournamentId,
        name: "Already Bought",
        age: 25,
        role: "Bowler",
        battingBowlingHand: "Right-handed",
        auctionStatus: "sold",
        teamId: teamA,
        soldPrice: 100_000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const adminRes = await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamA,
      amount: 100_000,
    });
    const ownerRes = await t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, {
      auctionRoomId: roomId,
    });
    expect(adminRes).toMatchObject({ success: false, reason: "Squad is full" });
    expect(ownerRes).toMatchObject({ success: false, reason: "Squad is full" });
  });

  test("non-finite amounts are rejected", async () => {
    const t = convexTest(schema, modules);
    const { roomId, teamA, playerId } = await setupBidding(t, { bidMode: "open" });

    for (const amount of [NaN, Infinity, -100_000]) {
      const owner = await t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, {
        auctionRoomId: roomId,
        amount,
      });
      expect(owner).toMatchObject({ success: false });
      const admin = await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.placeBid, {
        auctionRoomId: roomId,
        teamId: teamA,
        amount,
      });
      expect(admin).toMatchObject({ success: false });
    }
    expect(await liveBidsFor(t, playerId)).toHaveLength(0);
  });
});

describe("confirm mode", () => {
  test("request → accept creates exactly one owner-sourced live bid", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playerId, teamA, ownerA } = await setupBidding(t, { bidMode: "confirm" });

    const raise = await t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, {
      auctionRoomId: roomId,
    });
    expect(raise).toMatchObject({ success: true, pending: true, amount: 100_000 });
    // Nothing reaches the live feed until the auctioneer accepts.
    expect(await liveBidsFor(t, playerId)).toHaveLength(0);

    const accept = await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.acceptBidRequest, {
      requestId: requestIdOf(raise),
    });
    expect(accept).toMatchObject({ success: true });

    const bids = await liveBidsFor(t, playerId);
    expect(bids).toHaveLength(1);
    expect(bids[0]).toMatchObject({ teamId: teamA, amount: 100_000, source: "owner", userId: ownerA });

    const [request] = await requestsFor(t, playerId);
    expect(request.status).toBe("accepted");

    // Accepting twice does nothing.
    const again = await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.acceptBidRequest, {
      requestId: requestIdOf(raise),
    });
    expect(again).toMatchObject({ success: false });
    expect(await liveBidsFor(t, playerId)).toHaveLength(1);

    await t.run(async (ctx) => {
      const actions = (await ctx.db.query("auditLogs").collect()).map((l) => l.action);
      expect(actions).toContain("accept_bid_request");
    });
  });

  test("accepting a stale request after a higher bid fails cleanly", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playerId, teamB } = await setupBidding(t, { bidMode: "confirm" });

    const raise = await t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, {
      auctionRoomId: roomId,
    }); // 100k
    await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.placeBid, {
      auctionRoomId: roomId,
      teamId: teamB,
      amount: 150_000,
    });

    const accept = await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.acceptBidRequest, {
      requestId: requestIdOf(raise),
    });
    expect(accept).toMatchObject({ success: false, reason: "Minimum bid is 175000" });

    const bids = await liveBidsFor(t, playerId);
    expect(bids).toHaveLength(1);
    expect(bids[0].teamId).toBe(teamB);
    const [request] = await requestsFor(t, playerId);
    expect(request).toMatchObject({ status: "rejected", reason: "Minimum bid is 175000" });
  });

  test("two owners raise: both are pending, accepting the higher supersedes the lower", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playerId, teamB } = await setupBidding(t, { bidMode: "confirm" });

    const [a, b] = await Promise.all([
      t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, { auctionRoomId: roomId, amount: 100_000 }),
      t.withIdentity(OWNER_B).mutation(api.auctions.raiseBid, { auctionRoomId: roomId, amount: 125_000 }),
    ]);
    expect(a.success && b.success).toBe(true);
    expect((await requestsFor(t, playerId)).map((r) => r.status)).toEqual(["pending", "pending"]);

    await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.acceptBidRequest, {
      requestId: requestIdOf(b),
    });

    const byId = new Map((await requestsFor(t, playerId)).map((r) => [r._id, r]));
    expect(byId.get(requestIdOf(b))?.status).toBe("accepted");
    expect(byId.get(requestIdOf(a))?.status).toBe("superseded");
    const bids = await liveBidsFor(t, playerId);
    expect(bids).toHaveLength(1);
    expect(bids[0]).toMatchObject({ teamId: teamB, amount: 125_000 });
  });

  test("accepting the lower raise keeps the higher one pending", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playerId } = await setupBidding(t, { bidMode: "confirm" });

    const a = await t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, { auctionRoomId: roomId, amount: 100_000 });
    const b = await t.withIdentity(OWNER_B).mutation(api.auctions.raiseBid, { auctionRoomId: roomId, amount: 150_000 });
    await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.acceptBidRequest, { requestId: requestIdOf(a) });

    const byId = new Map((await requestsFor(t, playerId)).map((r) => [r._id, r]));
    expect(byId.get(requestIdOf(b))?.status).toBe("pending");
  });

  test("a team's newer raise supersedes its pending one; rapid repeats are spaced", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playerId } = await setupBidding(t, { bidMode: "confirm" });
    const asOwner = t.withIdentity(OWNER_A);

    const first = await asOwner.mutation(api.auctions.raiseBid, { auctionRoomId: roomId });
    const tooSoon = await asOwner.mutation(api.auctions.raiseBid, { auctionRoomId: roomId, amount: 150_000 });
    expect(tooSoon).toMatchObject({ success: false, reason: "Please wait before bidding again" });

    await ageRequests(t);
    const second = await asOwner.mutation(api.auctions.raiseBid, { auctionRoomId: roomId, amount: 150_000 });
    expect(second).toMatchObject({ success: true, pending: true });

    const byId = new Map((await requestsFor(t, playerId)).map((r) => [r._id, r]));
    expect(byId.size).toBe(2);
    expect(byId.get(requestIdOf(first))?.status).toBe("superseded");
    expect(byId.get(requestIdOf(second))?.status).toBe("pending");
  });

  test("reject marks the request with a reason and is audit-logged", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playerId } = await setupBidding(t, { bidMode: "confirm" });
    const raise = await t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, { auctionRoomId: roomId });

    const res = await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.rejectBidRequest, {
      requestId: requestIdOf(raise),
      reason: "Paddle not raised in the room",
    });
    expect(res).toMatchObject({ success: true });

    const [request] = await requestsFor(t, playerId);
    expect(request).toMatchObject({ status: "rejected", reason: "Paddle not raised in the room" });
    expect(await liveBidsFor(t, playerId)).toHaveLength(0);
    await t.run(async (ctx) => {
      const actions = (await ctx.db.query("auditLogs").collect()).map((l) => l.action);
      expect(actions).toContain("reject_bid_request");
    });
  });

  test("a request for a player who is no longer up cannot be accepted", async () => {
    const t = convexTest(schema, modules);
    const { roomId, tournamentId, playerId } = await setupBidding(t, { bidMode: "confirm" });
    const raise = await t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, { auctionRoomId: roomId });
    await putPlayerInAuction(t, { tournamentId, roomId }); // next player is up

    const res = await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.acceptBidRequest, {
      requestId: requestIdOf(raise),
    });
    expect(res).toMatchObject({ success: false });
    const [request] = await requestsFor(t, playerId);
    expect(request.status).toBe("superseded");
  });

  test("only admins can accept or reject", async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await setupBidding(t, { bidMode: "confirm" });
    const raise = await t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, { auctionRoomId: roomId });

    await expect(
      t.withIdentity(OWNER_B).mutation(api.auctions.acceptBidRequest, { requestId: requestIdOf(raise) }),
    ).rejects.toThrow(/admin/i);
    await expect(
      t.withIdentity(OWNER_A).mutation(api.auctions.rejectBidRequest, { requestId: requestIdOf(raise) }),
    ).rejects.toThrow(/admin/i);
  });
});

describe("open mode", () => {
  // Mirrors auctions.test.ts: concurrent bids can't both win at the same price.
  test("two concurrent equal raises create exactly one live bid", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playerId } = await setupBidding(t, { bidMode: "open" });

    const [r1, r2] = await Promise.all([
      t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, { auctionRoomId: roomId, amount: 100_000 }),
      t.withIdentity(OWNER_B).mutation(api.auctions.raiseBid, { auctionRoomId: roomId, amount: 100_000 }),
    ]);
    expect([r1, r2].filter((r) => r.success)).toHaveLength(1);

    const bids = await liveBidsFor(t, playerId);
    expect(bids).toHaveLength(1);
    expect(bids[0].amount).toBe(100_000);
    expect(await requestsFor(t, playerId)).toHaveLength(0);
  });

  test("the default raise is the minimum valid next bid", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playerId, teamB } = await setupBidding(t, { bidMode: "open" });

    await t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, { auctionRoomId: roomId });
    const res = await t.withIdentity(OWNER_B).mutation(api.auctions.raiseBid, { auctionRoomId: roomId });
    expect(res).toMatchObject({ success: true, teamId: teamB, amount: 125_000 });
    expect(await liveBidsFor(t, playerId)).toHaveLength(2);
  });
});

describe("bid provenance", () => {
  test("admin bids record source and user, and the archived winning bid keeps them", async () => {
    const t = convexTest(schema, modules);
    const { roomId, playerId, teamA, adminId } = await setupBidding(t, { bidMode: "open" });
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    await asAdmin.mutation(api.auctions.placeBid, { auctionRoomId: roomId, teamId: teamA, amount: 100_000 });
    expect((await liveBidsFor(t, playerId))[0]).toMatchObject({ source: "admin", userId: adminId });

    await asAdmin.mutation(api.auctions.finalizePlayerSale, { auctionRoomId: roomId });
    await t.run(async (ctx) => {
      const archived = await ctx.db
        .query("bids")
        .withIndex("by_player", (q) => q.eq("playerId", playerId))
        .collect();
      expect(archived).toHaveLength(1);
      expect(archived[0]).toMatchObject({ source: "admin", userId: adminId, isFinal: true });
    });
  });
});

describe("getMyPaddle", () => {
  test("returns null for viewers who are not owners", async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await setupBidding(t, { bidMode: "confirm" });
    expect(await t.query(api.auctions.getMyPaddle, { auctionRoomId: roomId })).toBeNull();
    expect(
      await t.withIdentity(ADMIN_IDENTITY).query(api.auctions.getMyPaddle, { auctionRoomId: roomId }),
    ).toBeNull();
  });

  test("shows my limits, my pending raise, and whether I lead", async () => {
    const t = convexTest(schema, modules);
    const { roomId, teamA, playerId } = await setupBidding(t, { bidMode: "confirm" });
    const asOwner = t.withIdentity(OWNER_A);

    let paddle = await asOwner.query(api.auctions.getMyPaddle, { auctionRoomId: roomId });
    expect(paddle).toMatchObject({
      bidMode: "confirm",
      team: { _id: teamA, name: "Team A" },
      purseRemaining: 1_000_000,
      playersNeeded: 3,
      maxAllowedBid: 800_000,
      minNextBid: 100_000,
      minBidIncrement: 25_000,
      isLeading: false,
      currentPlayerId: playerId,
      myPending: null,
      lastResolved: null,
    });

    const raise = await asOwner.mutation(api.auctions.raiseBid, { auctionRoomId: roomId });
    paddle = await asOwner.query(api.auctions.getMyPaddle, { auctionRoomId: roomId });
    expect(paddle?.myPending).toMatchObject({ _id: requestIdOf(raise), amount: 100_000 });

    await t.withIdentity(ADMIN_IDENTITY).mutation(api.auctions.acceptBidRequest, {
      requestId: requestIdOf(raise),
    });
    paddle = await asOwner.query(api.auctions.getMyPaddle, { auctionRoomId: roomId });
    expect(paddle).toMatchObject({
      isLeading: true,
      minNextBid: 125_000,
      myPending: null,
      lastResolved: { _id: requestIdOf(raise), status: "accepted", amount: 100_000 },
    });

    // Owner B sees that they are not leading.
    const paddleB = await t.withIdentity(OWNER_B).query(api.auctions.getMyPaddle, { auctionRoomId: roomId });
    expect(paddleB).toMatchObject({ isLeading: false, minNextBid: 125_000 });
  });
});

describe("getPendingBidRequests", () => {
  test("admin sees the current player's pending raises newest first; others see none", async () => {
    const t = convexTest(schema, modules);
    const { roomId, teamA, teamB } = await setupBidding(t, { bidMode: "confirm" });

    await t.withIdentity(OWNER_A).mutation(api.auctions.raiseBid, { auctionRoomId: roomId, amount: 100_000 });
    await t.withIdentity(OWNER_B).mutation(api.auctions.raiseBid, { auctionRoomId: roomId, amount: 125_000 });

    const tray = await t.withIdentity(ADMIN_IDENTITY).query(api.auctions.getPendingBidRequests, {
      auctionRoomId: roomId,
    });
    expect(tray.minNextBid).toBe(100_000);
    expect(tray.requests.map((r) => [r.teamId, r.amount])).toEqual([
      [teamB, 125_000],
      [teamA, 100_000],
    ]);
    expect(tray.requests[0]).toMatchObject({ teamName: "Team B", colorPrimary: "#111111" });

    const asOwner = await t.withIdentity(OWNER_A).query(api.auctions.getPendingBidRequests, {
      auctionRoomId: roomId,
    });
    expect(asOwner.requests).toHaveLength(0);
  });
});
