/// <reference types="vite/client" />
// Organisers invite team owners to add their own team: an email with the
// tournament's team sign-up link (/tournament/<id>/join-team). The owner
// registers the team there (teamRequests:submit) and the organiser verifies
// it. Fixtures follow auctions.test.ts (see there for why _generated stays
// in the glob).
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const OWNER = { email: "owner@test.com", subject: "owner|1" };
const AUCTIONEER = { email: "auctioneer@test.com", subject: "auctioneer|1" };
const OTHER_ORG = { email: "other@test.com", subject: "other|1" };
const INVITEE = { email: "sam@example.com", subject: "sam|1" };
const APP = "https://app.example";
const DAY = 24 * 60 * 60 * 1000;

type T = ReturnType<typeof convexTest>;

async function setup(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", { email: OWNER.email, name: "Olive", createdAt: now });
    const auctioneer = await ctx.db.insert("users", { email: AUCTIONEER.email, createdAt: now });
    await ctx.db.insert("users", { email: OTHER_ORG.email, createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Coastal & <Cup>",
      createdBy: owner,
      status: "setup",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5 },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: owner, role: "owner", createdAt: now });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: auctioneer, role: "auctioneer", createdAt: now });
    return { tournamentId };
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Bid11Pro <no-reply@app.example>";
  process.env.APP_URL = APP;
  fetchMock = vi.fn(async () => Response.json({ id: "email_1" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const key of ["RESEND_API_KEY", "EMAIL_FROM", "APP_URL"]) delete process.env[key];
});

const sentBodies = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));

describe("teamRequests.inviteOwner", () => {
  test("emails the team sign-up link; the invite shows in the owner's list with its status", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.withIdentity(OWNER).mutation(api.teamRequests.inviteOwner, { tournamentId, email: " Sam@Example.com " });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [body] = sentBodies();
    expect(body.to).toEqual(["sam@example.com"]);
    expect(body.subject).toBe("Add your team to Coastal & <Cup>");
    expect(body.text).toContain(`${APP}/tournament/${tournamentId}/join-team`);
    expect(body.text).toContain("Olive");
    expect(body.html).toContain("Coastal &amp; &lt;Cup&gt;");

    const invites = await t.withIdentity(OWNER).query(api.teamRequests.listOwnerInvites, { tournamentId });
    expect(invites).toEqual([expect.objectContaining({ email: "sam@example.com", status: "sent" })]);
  });

  test("only the tournament's owner can invite or see invites", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    for (const who of [AUCTIONEER, OTHER_ORG]) {
      await expect(t.withIdentity(who).mutation(api.teamRequests.inviteOwner, { tournamentId, email: "x@example.com" })).rejects.toThrow(/access/);
      await expect(t.withIdentity(who).query(api.teamRequests.listOwnerInvites, { tournamentId })).rejects.toThrow(/access/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a malformed address is refused", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await expect(t.withIdentity(OWNER).mutation(api.teamRequests.inviteOwner, { tournamentId, email: "nope" })).rejects.toThrow(/valid email/);
  });

  test("the same address is invited once a day; a failed email can be sent again", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.teamRequests.inviteOwner, { tournamentId, email: "sam@example.com" });
    await expect(asOwner.mutation(api.teamRequests.inviteOwner, { tournamentId, email: "SAM@example.com" })).rejects.toThrow(/already invited/);

    vi.advanceTimersByTime(DAY);
    await asOwner.mutation(api.teamRequests.inviteOwner, { tournamentId, email: "sam@example.com" });

    fetchMock.mockImplementation(async () => Response.json({ message: "bad" }, { status: 422 }));
    await asOwner.mutation(api.teamRequests.inviteOwner, { tournamentId, email: "lee@example.com" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    fetchMock.mockImplementation(async () => Response.json({ id: "email_2" }));
    await asOwner.mutation(api.teamRequests.inviteOwner, { tournamentId, email: "lee@example.com" });
  });

  test("shares the per-organiser invite email cap with team-owner invites", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    for (let i = 0; i < 30; i++) await asOwner.mutation(api.teamRequests.inviteOwner, { tournamentId, email: `p${i}@example.com` });
    await expect(asOwner.mutation(api.teamRequests.inviteOwner, { tournamentId, email: "p30@example.com" })).rejects.toThrow(/Too many invite emails/);
  });

  test("the invitee can then register a team after choosing team owner", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.withIdentity(OWNER).mutation(api.teamRequests.inviteOwner, { tournamentId, email: INVITEE.email });
    const asInvitee = t.withIdentity(INVITEE);
    await asInvitee.mutation(api.auth.ensureUser, {});
    await asInvitee.mutation(api.auth.setAccountType, { accountType: "team_owner" });
    await asInvitee.mutation(api.teamRequests.submit, { tournamentId, name: "Night Owls", ownerName: "Sam", colorPrimary: "#3B82F6", colorSecondary: "#1D4ED8" });
    expect((await t.withIdentity(OWNER).query(api.teamRequests.listForTournament, { tournamentId })).map((r) => r.name)).toEqual(["Night Owls"]);
  });
});

describe("tournaments.getJoinTeamInfo", () => {
  test("the join page's public view of the tournament: name, logo, whether teams can still be added", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    expect(await t.query(api.tournaments.getJoinTeamInfo, { tournamentId })).toEqual({ name: "Coastal & <Cup>", open: true });
    await t.run((ctx) => ctx.db.patch(tournamentId, { status: "completed" }));
    expect(await t.query(api.tournaments.getJoinTeamInfo, { tournamentId })).toMatchObject({ open: false });
    await t.run((ctx) => ctx.db.patch(tournamentId, { isActive: false }));
    expect(await t.query(api.tournaments.getJoinTeamInfo, { tournamentId })).toBeNull();
  });
});
