/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { syncTournamentAuctionCounts } from "./auctionCounts";

// Step 16a: organiser isolation. Fixtures follow auctions.test.ts (see there
// for why _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);
// The same modules loaded eagerly, to enumerate every exported mutation.
const loaded = import.meta.glob(["./*.ts", "!./*.test.ts", "!./schema.ts"], { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

const SUPER = { email: "super@test.com", subject: "super|1" };
const ORG_A = { email: "a@test.com", subject: "a|1" };
const AUCTIONEER_A = { email: "auctioneer-a@test.com", subject: "aa|1" };
const ORG_B = { email: "b@test.com", subject: "b|1" };

const NO_ACCESS = /access to this tournament/;

const SETTINGS: Doc<"tournaments">["settings"] = {
  basePurse: 1_000_000,
  minBidIncrement: 25_000,
  maxPlayersPerTeam: 5,
  basePrice: 100_000,
  bidMode: "confirm",
};

type T = ReturnType<typeof convexTest>;

/** Organiser A's tournament with a live room, a player on the block, a bid and a raise. */
async function seed(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const user = (email: string, role?: "admin") => ctx.db.insert("users", { email, role, createdAt: now });
    await user(SUPER.email, "admin");
    const orgA = await user(ORG_A.email);
    const auctioneerA = await user(AUCTIONEER_A.email);
    const orgB = await user(ORG_B.email);

    const tournament = (createdBy: Id<"users">, name: string) =>
      ctx.db.insert("tournaments", { name, createdBy, status: "active", settings: SETTINGS, createdAt: now, updatedAt: now });
    const tA = await tournament(orgA, "A Cup");
    const tB = await tournament(orgB, "B Cup");
    await ctx.db.insert("tournamentStaff", { tournamentId: tA, userId: orgA, role: "owner", createdAt: now });
    const staffAuctioneer = await ctx.db.insert("tournamentStaff", { tournamentId: tA, userId: auctioneerA, role: "auctioneer", createdAt: now });
    await ctx.db.insert("tournamentStaff", { tournamentId: tB, userId: orgB, role: "owner", createdAt: now });

    const team = (tournamentId: Id<"tournaments">, name: string) =>
      ctx.db.insert("teams", {
        tournamentId,
        name,
        ownerName: "owner",
        purseRemaining: 900_000,
        purseSpent: 100_000,
        colorPrimary: "#111111",
        colorSecondary: "#222222",
        createdAt: now,
        updatedAt: now,
      });
    const teamA1 = await team(tA, "A One");
    const teamA2 = await team(tA, "A Two");
    await team(tB, "B One");

    const player = (fields: Partial<Doc<"players">>) =>
      ctx.db.insert("players", {
        tournamentId: tA,
        name: "Player",
        age: 25,
        role: ["Batter"],
        battingBowlingHand: "Right-handed",
        phoneNumber: "9876543210",
        auctionStatus: "pending",
        createdAt: now,
        updatedAt: now,
        ...fields,
      });
    const pending = await player({ name: "Pending" });
    const sold = await player({ name: "Sold", auctionStatus: "sold", teamId: teamA1, soldPrice: 100_000 });
    const onBlock = await player({ name: "On block", auctionStatus: "in_auction" });

    const roomA = await ctx.db.insert("auctionRooms", {
      tournamentId: tA,
      name: "Room A",
      status: "live",
      currentPlayerId: onBlock,
      createdBy: orgA,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("liveBids", {
      auctionRoomId: roomA,
      playerId: onBlock,
      teamId: teamA1,
      amount: 100_000,
      timestamp: now - 10_000,
      source: "admin",
      userId: orgA,
    });
    const request = await ctx.db.insert("bidRequests", {
      auctionRoomId: roomA,
      playerId: onBlock,
      teamId: teamA2,
      userId: orgA,
      amount: 125_000,
      status: "pending",
      createdAt: now,
    });
    const member = await ctx.db.insert("teamMembers", { teamId: teamA1, tournamentId: tA, userId: auctioneerA, role: "owner", createdAt: now });
    const invite = await ctx.db.insert("teamInvites", { teamId: teamA2, tournamentId: tA, tokenHash: "h", expiresAt: now + 86_400_000, createdBy: orgA });
    const registration = await ctx.db.insert("registrations", {
      tournamentId: tA, name: "Applicant", age: 20, role: ["Batter"], battingBowlingHand: "Right-handed",
      phoneNumber: "9000000009", consentWhatsApp: false, status: "paid", fee: 0, createdAt: now,
    });
    const snapshotA = await ctx.db.insert("tournamentSnapshots", {
      tournamentId: tA, tournamentName: "A Cup", reason: "before start_auction", createdBy: orgA,
      counts: { players: 0, teams: 0, bids: 0, events: 0 }, createdAt: now,
    });
    await syncTournamentAuctionCounts(ctx, tA);
    return { snapshotA, registration, orgA, orgB, auctioneerA, tA, tB, teamA1, teamA2, pending, sold, onBlock, roomA, request, member, invite, staffAuctioneer };
  });
}

type Fx = Awaited<ReturnType<typeof seed>>;
type Caller = ReturnType<T["withIdentity"]>;

const newPlayer = { name: "New Guy", age: 22, role: ["Bowler"], battingBowlingHand: "Right-handed" as const };

/** Every tournament-scoped public mutation, called on organiser A's data. */
const MUTATIONS: Record<string, (as: Caller, fx: Fx) => Promise<unknown>> = {
  "admin:reassignPlayer": (as, fx) => as.mutation(api.admin.reassignPlayer, { playerId: fx.sold, newTeamId: fx.teamA2 }),
  "admin:updateSoldPrice": (as, fx) => as.mutation(api.admin.updateSoldPrice, { playerId: fx.sold, newSoldPrice: 150_000 }),
  "admin:updatePlayerStatus": (as, fx) => as.mutation(api.admin.updatePlayerStatus, { playerId: fx.pending, newStatus: "unsold" }),
  "admin:clearCurrentPlayerBids": (as, fx) => as.mutation(api.admin.clearCurrentPlayerBids, { auctionRoomId: fx.roomA, reason: "x" }),
  "admin:adjustTeamPurse": (as, fx) => as.mutation(api.admin.adjustTeamPurse, { teamId: fx.teamA1, amount: 10_000, reason: "x" }),
  "admin:recalculateTeamPurse": (as, fx) => as.mutation(api.admin.recalculateTeamPurse, { teamId: fx.teamA1, reason: "x" }),
  "auctions:createAuctionRoom": (as, fx) => as.mutation(api.auctions.createAuctionRoom, { tournamentId: fx.tA, name: "R2" }),
  "auctions:startAuction": (as, fx) => as.mutation(api.auctions.startAuction, { auctionRoomId: fx.roomA }),
  "auctions:pauseAuction": (as, fx) => as.mutation(api.auctions.pauseAuction, { auctionRoomId: fx.roomA }),
  "auctions:resumeAuction": (as, fx) => as.mutation(api.auctions.resumeAuction, { auctionRoomId: fx.roomA }),
  "auctions:placeBid": (as, fx) => as.mutation(api.auctions.placeBid, { auctionRoomId: fx.roomA, teamId: fx.teamA2, amount: 125_000 }),
  "auctions:acceptBidRequest": (as, fx) => as.mutation(api.auctions.acceptBidRequest, { requestId: fx.request }),
  "auctions:rejectBidRequest": (as, fx) => as.mutation(api.auctions.rejectBidRequest, { requestId: fx.request }),
  "auctions:finalizePlayerSale": (as, fx) => as.mutation(api.auctions.finalizePlayerSale, { auctionRoomId: fx.roomA }),
  "auctions:markPlayerFinalUnsold": (as, fx) => as.mutation(api.auctions.markPlayerFinalUnsold, { auctionRoomId: fx.roomA }),
  "auctions:startNextPlayer": (as, fx) => as.mutation(api.auctions.startNextPlayer, { auctionRoomId: fx.roomA }),
  "auctions:resolveStalledRound": (as, fx) => as.mutation(api.auctions.resolveStalledRound, { auctionRoomId: fx.roomA, action: "end" }),
  "auctions:revertLastBid": (as, fx) => as.mutation(api.auctions.revertLastBid, { auctionRoomId: fx.roomA }),
  "auctions:restartCurrentPlayer": (as, fx) => as.mutation(api.auctions.restartCurrentPlayer, { auctionRoomId: fx.roomA }),
  "auctions:restartAuction": (as, fx) => as.mutation(api.auctions.restartAuction, { auctionRoomId: fx.roomA, confirmName: "A Cup" }),
  "groupDraws:runDraw": (as, fx) => as.mutation(api.groupDraws.runDraw, { tournamentId: fx.tA, numGroups: 2 }),
  "groupDraws:lockDraw": (as, fx) => as.mutation(api.groupDraws.lockDraw, { tournamentId: fx.tA }),
  "groupDraws:resetDraw": (as, fx) => as.mutation(api.groupDraws.resetDraw, { tournamentId: fx.tA }),
  "members:createInvite": (as, fx) => as.mutation(api.members.createInvite, { teamId: fx.teamA1 }),
  "members:removeMember": (as, fx) => as.mutation(api.members.removeMember, { memberId: fx.member }),
  "members:revokeInvite": (as, fx) => as.mutation(api.members.revokeInvite, { inviteId: fx.invite }),
  "payments:recordOrder": (as, fx) =>
    as.mutation(api.payments.recordOrder, { tournamentId: fx.tA, tier: "club", razorpayOrderId: "order_x", amount: 99_900 }),
  "registrations:approve": (as, fx) => as.mutation(api.registrations.approve, { registrationId: fx.registration }),
  "registrations:bulkApprove": (as, fx) => as.mutation(api.registrations.bulkApprove, { tournamentId: fx.tA }),
  "registrations:reject": (as, fx) => as.mutation(api.registrations.reject, { registrationId: fx.registration, reason: "x" }),
  "players:create": (as, fx) => as.mutation(api.players.create, { tournamentId: fx.tA, ...newPlayer }),
  "players:bulkImport": (as, fx) => as.mutation(api.players.bulkImport, { tournamentId: fx.tA, players: [newPlayer] }),
  "players:update": (as, fx) => as.mutation(api.players.update, { id: fx.pending, name: "Renamed" }),
  "players:deletePlayer": (as, fx) => as.mutation(api.players.deletePlayer, { id: fx.pending }),
  "players:deleteAllByTournament": (as, fx) => as.mutation(api.players.deleteAllByTournament, { tournamentId: fx.tA }),
  "staff:add": (as, fx) => as.mutation(api.staff.add, { tournamentId: fx.tA, email: ORG_B.email, role: "owner" }),
  "staff:remove": (as, fx) => as.mutation(api.staff.remove, { staffId: fx.staffAuctioneer }),
  "teams:create": (as, fx) =>
    as.mutation(api.teams.create, { tournamentId: fx.tA, name: "Intruders", ownerName: "B", colorPrimary: "#000000", colorSecondary: "#ffffff" }),
  "teams:update": (as, fx) => as.mutation(api.teams.update, { id: fx.teamA1, name: "Taken" }),
  "teams:deleteTeam": (as, fx) => as.mutation(api.teams.deleteTeam, { id: fx.teamA2 }),
  "tournaments:update": (as, fx) => as.mutation(api.tournaments.update, { id: fx.tA, name: "Hijacked" }),
  "tournaments:setActive": (as, fx) => as.mutation(api.tournaments.setActive, { id: fx.tA, isActive: false }),
  "tournaments:deleteTournament": (as, fx) => as.mutation(api.tournaments.deleteTournament, { id: fx.tA, confirmName: "A Cup" }),
  "snapshots:restoreSnapshot": (as, fx) => as.mutation(api.snapshots.restoreSnapshot, { snapshotId: fx.snapshotA, confirmName: "A Cup" }),
  "snapshots:startRehearsal": (as, fx) => as.mutation(api.snapshots.startRehearsal, { auctionRoomId: fx.roomA }),
  "snapshots:endRehearsal": (as, fx) => as.mutation(api.snapshots.endRehearsal, { auctionRoomId: fx.roomA }),
};

/** Public mutations that are deliberately not tournament-staff-scoped. */
const NOT_STAFF_SCOPED: Record<string, string> = {
  "auth:ensureUser": "creates the caller's own user row",
  "auth:setUserRole": "global, super-admin only (tested below)",
  "auctions:raiseBid": "team owners bidding from their paddle; checked by team membership",
  "members:claimInvite": "claimed with a one-time invite token",
  "plans:grantPlan": "super-admin only (tested in plans.test.ts)",
  "registrations:submit": "public registration form (anonymous; tested in registrations.test.ts)",
  "registrations:recordOrder": "anonymous registrant's fee order; only the signed webhook marks it paid",
  "tournaments:create": "any signed-in user; they become the owner",
};

/** Every table a tournament's data lives in, for a before/after comparison. */
async function snapshot(t: T) {
  return await t.run(async (ctx) => {
    const tables = ["tournaments", "teams", "players", "auctionRooms", "liveBids", "bidRequests", "teamMembers", "teamInvites", "tournamentStaff", "groupDraws", "paymentOrders", "registrations"] as const;
    const out: Record<string, unknown> = {};
    for (const table of tables) out[table] = await ctx.db.query(table).collect();
    return JSON.stringify(out);
  });
}

describe("organiser isolation", () => {
  test("every exported mutation is covered by the isolation table or explicitly exempt", () => {
    const exported = Object.entries(loaded).flatMap(([path, mod]) => {
      const file = path.replace("./", "").replace(".ts", "");
      return Object.entries(mod)
        .filter(([, fn]) => {
          const f = fn as { isMutation?: boolean; isPublic?: boolean };
          return f?.isMutation && f?.isPublic;
        })
        .map(([name]) => `${file}:${name}`);
    });
    const covered = new Set([...Object.keys(MUTATIONS), ...Object.keys(NOT_STAFF_SCOPED)]);
    expect(exported.filter((name) => !covered.has(name))).toEqual([]);
    expect([...covered].filter((name) => !exported.includes(name))).toEqual([]);
  });

  test.each(Object.keys(MUTATIONS))("organiser B is refused: %s", async (name) => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const before = await snapshot(t);
    await expect(MUTATIONS[name](t.withIdentity(ORG_B), fx)).rejects.toThrow(NO_ACCESS);
    expect(await snapshot(t)).toBe(before);
  });

  test("setUserRole stays super-admin only", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await expect(
      t.withIdentity(ORG_A).mutation(api.auth.setUserRole, { userId: fx.orgB, role: "admin" }),
    ).rejects.toThrow(/Admin access required/);
  });

  test("a super-admin passes every check", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await t.withIdentity(SUPER).mutation(api.tournaments.update, { id: fx.tA, name: "Renamed by super" });
    await t.withIdentity(SUPER).mutation(api.auctions.pauseAuction, { auctionRoomId: fx.roomA });
    expect((await t.run((ctx) => ctx.db.get(fx.tA)))?.name).toBe("Renamed by super");
  });
});

describe("auctioneer role", () => {
  test("runs the auction, corrects sales and uses the purse tools", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const as = t.withIdentity(AUCTIONEER_A);
    await expect(MUTATIONS["auctions:placeBid"](as, fx)).resolves.toMatchObject({ success: true });
    await expect(MUTATIONS["admin:updateSoldPrice"](as, fx)).resolves.toBeDefined();
    await expect(MUTATIONS["admin:adjustTeamPurse"](as, fx)).resolves.toMatchObject({ success: true });
    await expect(MUTATIONS["auctions:pauseAuction"](as, fx)).resolves.toMatchObject({ success: true });
  });

  test.each([
    "tournaments:update",
    "tournaments:deleteTournament",
    "teams:create",
    "players:create",
    "staff:add",
    "auctions:restartAuction",
    "auctions:createAuctionRoom",
    "members:createInvite",
    "groupDraws:runDraw",
    "snapshots:restoreSnapshot",
    "snapshots:startRehearsal",
    "snapshots:endRehearsal",
  ])("can't use owner-only %s", async (name) => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await expect(MUTATIONS[name](t.withIdentity(AUCTIONEER_A), fx)).rejects.toThrow(NO_ACCESS);
  });
});

describe("tournament creation and staff", () => {
  test("any signed-in user can create a tournament and becomes its owner", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const asB = t.withIdentity(ORG_B);
    const id = await asB.mutation(api.tournaments.create, {
      name: "B Two",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5 },
    });
    expect(await asB.query(api.tournaments.myRole, { tournamentId: id })).toBe("owner");
    await asB.mutation(api.teams.create, { tournamentId: id, name: "Mine", ownerName: "Bee", colorPrimary: "#000000", colorSecondary: "#ffffff" });
  });

  test("owners add and remove staff by email; the last owner stays", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const asA = t.withIdentity(ORG_A);

    await asA.mutation(api.staff.add, { tournamentId: fx.tA, email: ORG_B.email, role: "auctioneer" });
    expect(await t.withIdentity(ORG_B).query(api.tournaments.myRole, { tournamentId: fx.tA })).toBe("auctioneer");
    await expect(asA.mutation(api.staff.add, { tournamentId: fx.tA, email: ORG_B.email, role: "owner" })).rejects.toThrow(/already/);
    await expect(asA.mutation(api.staff.add, { tournamentId: fx.tA, email: "nobody@test.com", role: "auctioneer" })).rejects.toThrow(/sign in/);

    const list = await asA.query(api.staff.list, { tournamentId: fx.tA });
    expect(list.map((s) => s.role).sort()).toEqual(["auctioneer", "auctioneer", "owner"]);
    const ownerRow = list.find((s) => s.role === "owner")!;
    await expect(asA.mutation(api.staff.remove, { staffId: ownerRow._id })).rejects.toThrow(/last owner/);

    await asA.mutation(api.staff.remove, { staffId: fx.staffAuctioneer });
    expect(await t.withIdentity(AUCTIONEER_A).query(api.tournaments.myRole, { tournamentId: fx.tA })).toBeNull();
  });

  test("myRole: owner, auctioneer, super-admin, outsider", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const role = (who: typeof ORG_A) => t.withIdentity(who).query(api.tournaments.myRole, { tournamentId: fx.tA });
    expect(await role(ORG_A)).toBe("owner");
    expect(await role(AUCTIONEER_A)).toBe("auctioneer");
    expect(await role(SUPER)).toBe("super_admin");
    expect(await role(ORG_B)).toBeNull();
    expect(await t.query(api.tournaments.myRole, { tournamentId: fx.tA })).toBeNull();
  });

  test("listMine returns only the caller's tournaments", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const mine = await t.withIdentity(ORG_B).query(api.tournaments.listMine, {});
    expect(mine.map((x) => x._id)).toEqual([fx.tB]);
  });
});

describe("private data follows tournament access", () => {
  test("phone numbers: visible to A's staff, hidden from organiser B", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const phones = async (who: typeof ORG_A) =>
      (await t.withIdentity(who).query(api.players.listByTournament, { tournamentId: fx.tA })).map(
        (p) => ("phoneNumber" in p ? p.phoneNumber : undefined),
      );
    expect(await phones(ORG_A)).toContain("9876543210");
    expect(await phones(AUCTIONEER_A)).toContain("9876543210");
    expect((await phones(ORG_B)).filter(Boolean)).toEqual([]);
  });

  test("a deactivated tournament is visible to its staff only", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await t.run((ctx) => ctx.db.patch(fx.tA, { isActive: false }));
    expect(await t.withIdentity(ORG_A).query(api.tournaments.getById, { id: fx.tA })).not.toBeNull();
    expect(await t.withIdentity(ORG_B).query(api.tournaments.getById, { id: fx.tA })).toBeNull();
  });

  test("console-only queries refuse other organisers", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const asB = t.withIdentity(ORG_B);
    await expect(asB.query(api.auctions.getReconciliation, { tournamentId: fx.tA })).rejects.toThrow(NO_ACCESS);
    expect((await asB.query(api.auctions.getPendingBidRequests, { auctionRoomId: fx.roomA })).requests).toEqual([]);
    await expect(asB.query(api.results.getResultsExport, { tournamentId: fx.tA, includeContacts: true })).rejects.toThrow(NO_ACCESS);
    expect((await t.withIdentity(ORG_A).query(api.auctions.getPendingBidRequests, { auctionRoomId: fx.roomA })).requests).toHaveLength(1);
  });
});

describe("migration: backfillTournamentOwners", () => {
  test("makes each tournament's creator its owner, once", async () => {
    const t = convexTest(schema, modules);
    const tournamentId = await t.run(async (ctx) => {
      const now = Date.now();
      const creator = await ctx.db.insert("users", { email: ORG_A.email, createdAt: now });
      return await ctx.db.insert("tournaments", { name: "Legacy", createdBy: creator, status: "active", settings: SETTINGS, createdAt: now, updatedAt: now });
    });
    const first = await t.mutation(internal.staff.backfillTournamentOwners, {});
    const second = await t.mutation(internal.staff.backfillTournamentOwners, {});
    expect(first).toEqual({ added: 1 });
    expect(second).toEqual({ added: 0 });
    expect(await t.withIdentity(ORG_A).query(api.tournaments.myRole, { tournamentId })).toBe("owner");
  });
});
