/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// The super-admin People directory. Fixtures follow auctions.test.ts (see
// there for why _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const SUPER = { email: "super@test.com", subject: "super|1" };
const ORGANISER = { email: "org@test.com", subject: "org|1" };
const AUCTIONEER = { email: "auctioneer@test.com", subject: "auc|1" };
const OWNER = { email: "owner@test.com", subject: "own|1" };
const VIEWER = { email: "viewer@test.com", subject: "view|1" };

type T = ReturnType<typeof convexTest>;

async function seed(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const user = (email: string, name?: string, role?: "admin") => ctx.db.insert("users", { email, name, role, createdAt: now });
    await user(SUPER.email, "Super", "admin");
    const organiser = await user(ORGANISER.email, "Olga Organiser");
    const auctioneer = await user(AUCTIONEER.email, "Arun Auctioneer");
    const owner = await user(OWNER.email, "Omar Owner");
    await user(VIEWER.email, "Vic Viewer");
    const requester = await user("requester@test.com", "Rita Requester");

    const tournament = (name: string) =>
      ctx.db.insert("tournaments", {
        name,
        createdBy: organiser,
        status: "setup",
        settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5 },
        createdAt: now,
        updatedAt: now,
      });
    const tournamentId = await tournament("People Cup");
    const otherId = await tournament("Other Cup");
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: organiser, role: "owner", createdAt: now });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: auctioneer, role: "auctioneer", createdAt: now });

    const team = (tid: typeof tournamentId, name: string) =>
      ctx.db.insert("teams", {
        tournamentId: tid,
        name,
        ownerName: "Owner",
        purseRemaining: 1_000_000,
        purseSpent: 0,
        colorPrimary: "#111111",
        colorSecondary: "#222222",
        createdAt: now,
        updatedAt: now,
      });
    const alpha = await team(tournamentId, "Alpha");
    const bravo = await team(tournamentId, "Bravo");
    const elsewhere = await team(otherId, "Elsewhere");
    await ctx.db.insert("teamMembers", { teamId: alpha, tournamentId, userId: owner, role: "owner", createdAt: now });
    // A viewer member and another tournament's owner never show.
    await ctx.db.insert("teamMembers", { teamId: alpha, tournamentId, userId: requester, role: "viewer", createdAt: now });
    await ctx.db.insert("teamMembers", { teamId: elsewhere, tournamentId: otherId, userId: owner, role: "owner", createdAt: now });

    const invite = (fields: { email?: string; usedBy?: typeof owner; revokedAt?: number; expiresAt?: number }) =>
      ctx.db.insert("teamInvites", { teamId: bravo, tournamentId, tokenHash: Math.random().toString(), createdBy: organiser, expiresAt: now + 86_400_000, ...fields });
    await invite({ email: "pending@test.com" });
    await invite({ email: "revoked@test.com", revokedAt: now });
    await invite({ email: "expired@test.com", expiresAt: now - 1 });
    await invite({ email: OWNER.email, usedBy: owner });
    await invite({}); // a link with no address

    const signupInvite = (to: string) =>
      ctx.db.insert("emails", {
        kind: "team_signup_invite",
        dedupeKey: `team-signup:${tournamentId}:${to}:${now}`,
        tournamentId,
        to,
        payload: { tournamentId, tournamentName: "People Cup", inviterName: "Olga" },
        status: "sent",
        attempts: 1,
        nextAttemptAt: now,
        createdAt: now,
      });
    await signupInvite("signup@test.com");
    await signupInvite("signup@test.com"); // re-sent: listed once
    await signupInvite(OWNER.email); // already joined: not pending

    await ctx.db.insert("teamRequests", {
      tournamentId, userId: requester, name: "Rockets", ownerName: "Rita", colorPrimary: "#111111", colorSecondary: "#222222",
      status: "pending", createdAt: now,
    });
    return { tournamentId, otherId };
  });
}

describe("auth:tournamentPeople", () => {
  test("a super-admin sees organisers, team owners and pending invites", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    const people = await t.withIdentity(SUPER).query(api.auth.tournamentPeople, { tournamentId });

    expect(people.organisers).toEqual([
      { userId: expect.any(String), name: "Olga Organiser", email: ORGANISER.email, role: "owner" },
      { userId: expect.any(String), name: "Arun Auctioneer", email: AUCTIONEER.email, role: "auctioneer" },
    ]);
    expect(people.teamOwners).toEqual([
      { key: expect.any(String), name: "Omar Owner", email: OWNER.email, teamName: "Alpha", status: "joined" },
      { key: expect.any(String), name: "Rita Requester", email: "requester@test.com", teamName: "Rockets", status: "requested" },
      { key: expect.any(String), email: "pending@test.com", teamName: "Bravo", status: "invited" },
      { key: expect.any(String), email: "signup@test.com", status: "invited" },
    ]);
  });

  test("an empty tournament has empty lists", async () => {
    const t = convexTest(schema, modules);
    const { otherId } = await seed(t);
    await t.run(async (ctx) => {
      for (const m of await ctx.db.query("teamMembers").collect()) if (m.tournamentId === otherId) await ctx.db.delete(m._id);
    });
    expect(await t.withIdentity(SUPER).query(api.auth.tournamentPeople, { tournamentId: otherId })).toEqual({ organisers: [], teamOwners: [] });
  });

  test.each([
    ["the organiser", ORGANISER],
    ["an auctioneer", AUCTIONEER],
    ["a team owner", OWNER],
    ["a viewer", VIEWER],
  ])("%s is refused", async (_who, identity) => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    await expect(t.withIdentity(identity).query(api.auth.tournamentPeople, { tournamentId })).rejects.toThrow(/Admin access required/);
  });

  test("an anonymous caller is refused", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    await expect(t.query(api.auth.tournamentPeople, { tournamentId })).rejects.toThrow(/Not authenticated/);
  });

  test("a deactivated super-admin is refused", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    await t.run(async (ctx) => {
      const u = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", SUPER.email)).first();
      await ctx.db.patch(u!._id, { deactivatedAt: Date.now() });
    });
    await expect(t.withIdentity(SUPER).query(api.auth.tournamentPeople, { tournamentId })).rejects.toThrow(/deactivated/);
  });
});
