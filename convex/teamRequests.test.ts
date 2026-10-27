/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

// Team owners who sign up themselves: they say they own a team, request one
// in a tournament, and the organiser verifies it. Fixtures follow
// auctions.test.ts (see there for why _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ORGANISER = { email: "organiser@test.com", subject: "organiser|1" };
const OWNER = { email: "owner@test.com", subject: "owner|1" };
const OUTSIDER = { email: "outsider@test.com", subject: "outsider|1" };

type T = ReturnType<typeof convexTest>;

async function setup(t: T, maxTeams = 4) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const organiser = await ctx.db.insert("users", { email: ORGANISER.email, createdAt: now });
    await ctx.db.insert("users", { email: OUTSIDER.email, createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Open Cup",
      createdBy: organiser,
      status: "setup",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5 },
      plan: { tier: "free", maxTeams, maxPlayers: 60 },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: organiser, role: "owner", createdAt: now });
    return { tournamentId };
  });
}

const request = (tournamentId: Id<"tournaments">, over: Record<string, unknown> = {}) => ({
  tournamentId,
  name: "Night Owls",
  ownerName: "Sam Rao",
  colorPrimary: "#3B82F6",
  colorSecondary: "#1D4ED8",
  ...over,
});

describe("account type", () => {
  test("a new user picks team owner or visitor; me returns it", async () => {
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.auth.ensureUser, {});
    expect((await asOwner.query(api.auth.me, {}))?.accountType).toBeUndefined();
    await asOwner.mutation(api.auth.setAccountType, { accountType: "team_owner" });
    expect((await asOwner.query(api.auth.me, {}))?.accountType).toBe("team_owner");
    await asOwner.mutation(api.auth.setAccountType, { accountType: "visitor" });
    expect((await asOwner.query(api.auth.me, {}))?.accountType).toBe("visitor");
  });

  test("needs a signed-in user", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.auth.setAccountType, { accountType: "visitor" })).rejects.toThrow(/Not authenticated/);
  });
});

describe("team requests", () => {
  test("an owner requests a team; the organiser approves: team, membership and audit row", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    const requestId = await asOwner.mutation(api.teamRequests.submit, request(tournamentId));
    expect(await asOwner.query(api.teamRequests.listMine, {})).toMatchObject([{ _id: requestId, status: "pending", tournamentName: "Open Cup" }]);
    expect(await asOwner.query(api.teamRequests.getMineForTournament, { tournamentId })).toMatchObject({ status: "pending" });

    const teamId = await t.withIdentity(ORGANISER).mutation(api.teamRequests.approve, { requestId });
    const team = await t.run((ctx) => ctx.db.get(teamId));
    expect(team).toMatchObject({ name: "Night Owls", ownerName: "Sam Rao", purseRemaining: 1_000_000, purseSpent: 0 });

    const members = await t.run((ctx) => ctx.db.query("teamMembers").collect());
    const ownerUser = await t.run((ctx) => ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", OWNER.email)).first());
    expect(members).toMatchObject([{ teamId, tournamentId, userId: ownerUser!._id, role: "owner" }]);
    expect((await asOwner.query(api.teamRequests.listMine, {}))[0]).toMatchObject({ status: "approved", teamId });

    const logs = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(logs.map((l) => l.action)).toContain("approve_team_request");
  });

  test("validation: names, duplicates, one open request per tournament, closed tournaments", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    await expect(asOwner.mutation(api.teamRequests.submit, request(tournamentId, { name: "X" }))).rejects.toThrow(/Team name/);
    await expect(asOwner.mutation(api.teamRequests.submit, request(tournamentId, { colorPrimary: "blue" }))).rejects.toThrow(/colour/);
    await t.withIdentity(ORGANISER).mutation(api.teams.create, request(tournamentId, { name: "Taken" }));
    await expect(asOwner.mutation(api.teamRequests.submit, request(tournamentId, { name: " taken " }))).rejects.toThrow(/already exists/);

    await asOwner.mutation(api.teamRequests.submit, request(tournamentId));
    await expect(asOwner.mutation(api.teamRequests.submit, request(tournamentId, { name: "Second" }))).rejects.toThrow(/already have a request/);

    await t.run((ctx) => ctx.db.patch(tournamentId, { status: "completed" }));
    await expect(t.withIdentity(OUTSIDER).mutation(api.teamRequests.submit, request(tournamentId, { name: "Late" }))).rejects.toThrow(/closed/);
  });

  test("anonymous callers and existing team members can't request", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await expect(t.mutation(api.teamRequests.submit, request(tournamentId))).rejects.toThrow(/Not authenticated/);
    const asOwner = t.withIdentity(OWNER);
    const requestId = await asOwner.mutation(api.teamRequests.submit, request(tournamentId));
    await t.withIdentity(ORGANISER).mutation(api.teamRequests.approve, { requestId });
    await expect(asOwner.mutation(api.teamRequests.submit, request(tournamentId, { name: "Another" }))).rejects.toThrow(/already own a team/);
  });

  test("reject needs a reason; the owner may request again after", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    const asOrganiser = t.withIdentity(ORGANISER);
    const requestId = await asOwner.mutation(api.teamRequests.submit, request(tournamentId));
    await expect(asOrganiser.mutation(api.teamRequests.reject, { requestId, reason: " " })).rejects.toThrow(/reason/);
    await asOrganiser.mutation(api.teamRequests.reject, { requestId, reason: "Unknown owner" });
    expect((await asOwner.query(api.teamRequests.listMine, {}))[0]).toMatchObject({ status: "rejected", rejectReason: "Unknown owner" });
    await expect(asOrganiser.mutation(api.teamRequests.approve, { requestId })).rejects.toThrow(/Already rejected/);
    await asOwner.mutation(api.teamRequests.submit, request(tournamentId, { name: "Retry" }));
  });

  test("approval checks the plan's team limit and names taken since", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, 1);
    const requestId = await t.withIdentity(OWNER).mutation(api.teamRequests.submit, request(tournamentId));
    await t.withIdentity(ORGANISER).mutation(api.teams.create, request(tournamentId, { name: "First" }));
    await expect(t.withIdentity(ORGANISER).mutation(api.teamRequests.approve, { requestId })).rejects.toThrow(/plan/i);
  });

  test("the review list is owner-only", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.withIdentity(OWNER).mutation(api.teamRequests.submit, request(tournamentId));
    const list = await t.withIdentity(ORGANISER).query(api.teamRequests.listForTournament, { tournamentId });
    expect(list).toMatchObject([{ name: "Night Owls", requesterEmail: OWNER.email, status: "pending" }]);
    await expect(t.withIdentity(OUTSIDER).query(api.teamRequests.listForTournament, { tournamentId })).rejects.toThrow(/access to this tournament/);
  });
});
