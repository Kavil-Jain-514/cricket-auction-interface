/// <reference types="vite/client" />
// Invite emails: a team-owner invite (when the organiser gives an address)
// and being added to a tournament's staff. Same outbox pattern as WhatsApp:
// queued in the inviting transaction, sent by a worker through Resend, never
// twice, never blocking the invite. Fixtures follow auctions.test.ts (see
// there for why _generated stays in the glob).
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { escapeHtml } from "./emails";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const OWNER = { email: "owner@test.com", subject: "owner|1", name: "Olive Owner" };
const OTHER_ORG = { email: "other@test.com", subject: "other|1" };
const SUPER = { email: "super@test.com", subject: "super|1" };
const APP = "https://app.example";

type T = ReturnType<typeof convexTest>;

async function setup(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", { email: OWNER.email, name: OWNER.name, createdAt: now });
    await ctx.db.insert("users", { email: OTHER_ORG.email, createdAt: now });
    await ctx.db.insert("users", { email: SUPER.email, role: "admin", createdAt: now });
    await ctx.db.insert("users", { email: "auctioneer@test.com", name: "Arun", createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Coastal <Cup>",
      createdBy: owner,
      status: "setup",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5 },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: owner, role: "owner", createdAt: now });
    const teamId = await ctx.db.insert("teams", {
      tournamentId,
      name: "Strikers & Co",
      ownerName: "Sam",
      purseRemaining: 1_000_000,
      purseSpent: 0,
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      createdAt: now,
      updatedAt: now,
    });
    return { tournamentId, teamId };
  });
}

const outbox = (t: T) => t.run((ctx) => ctx.db.query("emails").collect());
const sent = () => resendMock.mock.calls.map((c) => ({ init: c[1] as RequestInit, body: JSON.parse((c[1] as RequestInit).body as string) }));

let resendMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Bid11Pro <no-reply@app.example>";
  process.env.APP_URL = APP;
  resendMock = vi.fn(async () => Response.json({ id: "email_1" }));
  vi.stubGlobal("fetch", resendMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const key of ["RESEND_API_KEY", "EMAIL_FROM", "APP_URL", "EMAIL_PROVIDER", "EMAIL_ENABLED"]) delete process.env[key];
});

describe("escapeHtml", () => {
  test("escapes markup", () => {
    expect(escapeHtml(`<b>"A" & 'B'</b>`)).toBe("&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;");
  });
});

describe("team-owner invite email", () => {
  test("with an address: the invite link is emailed once, through Resend, then wiped from the outbox", async () => {
    const t = convexTest(schema, modules);
    const { teamId } = await setup(t);
    const { token } = await t.withIdentity(OWNER).mutation(api.members.createInvite, { teamId, email: "  Sam@Example.COM " });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(resendMock).toHaveBeenCalledTimes(1);
    const [url] = resendMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://api.resend.com/emails");
    const { init, body } = sent()[0];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    expect(headers["Idempotency-Key"]).toMatch(/^invite:/);
    expect(body).toMatchObject({ from: "Bid11Pro <no-reply@app.example>", to: ["sam@example.com"] });
    expect(body.subject).toBe("You're invited to own Strikers & Co in Coastal <Cup>");
    expect(body.text).toContain(`${APP}/join/${token}`);
    expect(body.text).toContain("Olive Owner");
    expect(body.html).toContain(`href="${APP}/join/${token}"`);
    expect(body.html).toContain("Strikers &amp; Co");
    expect(body.html).toContain("Coastal &lt;Cup&gt;");
    expect(body.html).not.toContain("<Cup>");

    const [row] = await outbox(t);
    expect(row).toMatchObject({ status: "sent", providerId: "email_1", to: "sam@example.com" });
    // The one-time link is gone from the database once sent.
    expect(JSON.stringify(row)).not.toContain(token);
  });

  test("without an address nothing is emailed (copy / WhatsApp as before)", async () => {
    const t = convexTest(schema, modules);
    const { teamId } = await setup(t);
    const res = await t.withIdentity(OWNER).mutation(api.members.createInvite, { teamId });
    expect(res.token).toBeTruthy();
    expect(await outbox(t)).toEqual([]);
  });

  test("a malformed address is refused and no invite is created", async () => {
    const t = convexTest(schema, modules);
    const { teamId } = await setup(t);
    await expect(t.withIdentity(OWNER).mutation(api.members.createInvite, { teamId, email: "not-an-email" })).rejects.toThrow(/valid email/);
    expect(await t.run((ctx) => ctx.db.query("teamInvites").collect())).toEqual([]);
  });

  test("an invite revoked before the email goes out is never sent, and its link is wiped", async () => {
    const t = convexTest(schema, modules);
    const { teamId } = await setup(t);
    const { inviteId, token } = await t.withIdentity(OWNER).mutation(api.members.createInvite, { teamId, email: "sam@example.com" });
    await t.withIdentity(OWNER).mutation(api.members.revokeInvite, { inviteId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(resendMock).not.toHaveBeenCalled();
    const [row] = await outbox(t);
    expect(row).toMatchObject({ status: "skipped", lastError: "invite_no_longer_valid" });
    expect(JSON.stringify(row)).not.toContain(token);
  });

  test("the owner sees who an open invite was emailed to and whether it went", async () => {
    const t = convexTest(schema, modules);
    const { teamId } = await setup(t);
    await t.withIdentity(OWNER).mutation(api.members.createInvite, { teamId, email: "sam@example.com" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const listing = await t.withIdentity(OWNER).query(api.members.listMembers, { teamId });
    expect(listing?.invites).toEqual([expect.objectContaining({ email: "sam@example.com", emailStatus: "sent" })]);
  });

  test("invite emails are capped per organiser per hour", async () => {
    const t = convexTest(schema, modules);
    const { teamId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    for (let i = 0; i < 30; i++) await asOwner.mutation(api.members.createInvite, { teamId, email: `p${i}@example.com` });
    await expect(asOwner.mutation(api.members.createInvite, { teamId, email: "p31@example.com" })).rejects.toThrow(/Too many invite emails/);
    // A link without an email still works.
    await asOwner.mutation(api.members.createInvite, { teamId });
  });

  test("other organisers can't create invites for this team at all", async () => {
    const t = convexTest(schema, modules);
    const { teamId } = await setup(t);
    await expect(t.withIdentity(OTHER_ORG).mutation(api.members.createInvite, { teamId, email: "x@example.com" })).rejects.toThrow(/access/);
    expect(await outbox(t)).toEqual([]);
  });
});

describe("staff added email", () => {
  test("adding an auctioneer emails them a link to the tournament", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.withIdentity(OWNER).mutation(api.staff.add, { tournamentId, email: "Auctioneer@test.com", role: "auctioneer" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const { body } = sent()[0];
    expect(body.to).toEqual(["auctioneer@test.com"]);
    expect(body.subject).toBe("You're an auctioneer for Coastal <Cup>");
    expect(body.text).toContain(`${APP}/tournament/${tournamentId}`);
    expect(body.text).toContain("Hi Arun");
    expect(body.text).toContain("run the live auction");
  });

  test("adding an owner says so", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.withIdentity(OWNER).mutation(api.staff.add, { tournamentId, email: "auctioneer@test.com", role: "owner" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sent()[0].body.subject).toBe("You're now an owner of Coastal <Cup>");
  });
});

describe("delivery", () => {
  test("a 5xx or network error is retried with backoff, then marked failed", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    resendMock.mockImplementation(async () => new Response("down", { status: 503 }));
    await t.withIdentity(OWNER).mutation(api.staff.add, { tournamentId, email: "auctioneer@test.com", role: "auctioneer" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(resendMock).toHaveBeenCalledTimes(5);
    expect((await outbox(t))[0]).toMatchObject({ status: "failed", attempts: 5 });
    // Every retry carried the same idempotency key.
    expect(new Set(sent().map((s) => (s.init.headers as Record<string, string>)["Idempotency-Key"])).size).toBe(1);
  });

  test("a 4xx (bad address, unverified domain) fails at once: retrying can't help", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    resendMock.mockImplementation(async () => Response.json({ message: "The from domain is not verified" }, { status: 422 }));
    await t.withIdentity(OWNER).mutation(api.staff.add, { tournamentId, email: "auctioneer@test.com", role: "auctioneer" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(resendMock).toHaveBeenCalledTimes(1);
    expect((await outbox(t))[0]).toMatchObject({ status: "failed" });
    expect((await outbox(t))[0].lastError).toContain("not verified");
  });

  test("an email failure never fails the invite or the staff change", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    resendMock.mockImplementation(async () => {
      throw new Error("network down");
    });
    await t.withIdentity(OWNER).mutation(api.staff.add, { tournamentId, email: "auctioneer@test.com", role: "auctioneer" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("tournamentStaff").collect())).toHaveLength(2);
  });

  test.each([
    ["the log provider (development)", { EMAIL_PROVIDER: "log" }, "sent"],
    ["the off switch", { EMAIL_ENABLED: "false" }, "skipped"],
    ["no API key", { RESEND_API_KEY: "" }, "skipped"],
  ])("%s sends nothing over the network", async (_label, env, status) => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    Object.assign(process.env, env);
    await t.withIdentity(OWNER).mutation(api.staff.add, { tournamentId, email: "auctioneer@test.com", role: "auctioneer" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(resendMock).not.toHaveBeenCalled();
    expect((await outbox(t))[0].status).toBe(status);
  });

  test("queue health is for the super-admin only", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    expect(await t.withIdentity(OWNER).query(api.emails.stats, {})).toBeNull();
    expect(await t.withIdentity(SUPER).query(api.emails.stats, {})).toMatchObject({ queued: 0, failed: 0 });
  });

  test("deleting the tournament deletes its emails (they hold addresses)", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.withIdentity(OWNER).mutation(api.staff.add, { tournamentId, email: "auctioneer@test.com", role: "auctioneer" });
    await t.withIdentity(OWNER).mutation(api.tournaments.deleteTournament, { id: tournamentId, confirmName: "Coastal <Cup>" });
    expect(await outbox(t)).toEqual([]);
  });
});
