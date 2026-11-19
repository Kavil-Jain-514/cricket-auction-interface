/// <reference types="vite/client" />
// Registration admins ("registrar" staff), staff invites for people without
// an account, the registration fee switch, the organisation logo, and
// user-facing errors (ConvexError). Fixtures follow auctions.test.ts (see
// there for why _generated stays in the glob).
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { canUploadToFolder, runsAuction } from "./policy";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const OWNER = { email: "owner@test.com", subject: "owner|1", name: "Olive" };
const REGISTRAR = { email: "reg@test.com", subject: "reg|1", name: "Rita" };
const NEWBIE = { email: "newbie@test.com", subject: "newbie|1", name: "Nina" };
const OUTSIDER = { email: "outsider@test.com", subject: "out|1" };
const NO_ACCESS = /access to this tournament/;
const LOGO = "https://res.cloudinary.com/demo/image/upload/v1/cricket-auction/tournaments/org.png";

const SETTINGS: Doc<"tournaments">["settings"] = {
  basePurse: 1_000_000,
  minBidIncrement: 25_000,
  maxPlayersPerTeam: 5,
  basePrice: 100_000,
};

type T = ReturnType<typeof convexTest>;

async function setup(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", { email: OWNER.email, name: OWNER.name, createdAt: now });
    const registrar = await ctx.db.insert("users", { email: REGISTRAR.email, name: REGISTRAR.name, createdAt: now });
    await ctx.db.insert("users", { email: OUTSIDER.email, createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Coastal Cup",
      createdBy: owner,
      status: "setup",
      settings: { ...SETTINGS, registrationOpen: true, registrationFee: 200 },
      plan: { tier: "club", maxTeams: 8, maxPlayers: 150, paidAt: now, paymentRef: "pay_SECRET" },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: owner, role: "owner", createdAt: now });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: registrar, role: "registrar", createdAt: now });
    const registration = (name: string, status: Doc<"registrations">["status"], phone: string) =>
      ctx.db.insert("registrations", {
        tournamentId,
        name,
        age: 20,
        role: ["Batter"],
        battingBowlingHand: "Right-handed",
        phoneNumber: phone,
        consentWhatsApp: false,
        status,
        fee: 200,
        createdAt: now,
      });
    const ready = await registration("Ready Ravi", "paid", "9000000001");
    const unpaid = await registration("Unpaid Uma", "pending_payment", "9000000002");
    const other = await registration("Other Om", "paid", "9000000003");
    return { tournamentId, owner, registrar, ready, unpaid, other };
  });
}

const staffRows = async (t: T, tournamentId: Id<"tournaments">) =>
  (await t.run((ctx) => ctx.db.query("tournamentStaff").collect())).filter((s) => s.tournamentId === tournamentId);

describe("registration admin (registrar)", () => {
  test("reviews registrations: list, approve, reject, mark paid, category", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    const as = t.withIdentity(REGISTRAR);

    expect(await as.query(api.tournaments.myRole, { tournamentId: fx.tournamentId })).toBe("registrar");
    const rows = await as.query(api.registrations.list, { tournamentId: fx.tournamentId });
    expect(rows.map((r) => r.name).sort()).toEqual(["Other Om", "Ready Ravi", "Unpaid Uma"]);

    const playerId = await as.mutation(api.registrations.approve, { registrationId: fx.ready });
    expect(await t.run((ctx) => ctx.db.get(playerId))).toMatchObject({ name: "Ready Ravi", auctionStatus: "pending" });
    await as.mutation(api.registrations.markPaid, { registrationId: fx.unpaid });
    await as.mutation(api.registrations.setCategory, { registrationId: fx.unpaid, categoryId: undefined });
    await as.mutation(api.registrations.reject, { registrationId: fx.other, reason: "Not local" });
    expect(await as.mutation(api.registrations.bulkApprove, { tournamentId: fx.tournamentId })).toMatchObject({ approved: 1 });

    const logs = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(logs.filter((l) => l.userId === fx.registrar).map((l) => l.action).sort()).toEqual([
      "approve_registration",
      "approve_registration",
      "mark_registration_paid",
      "reject_registration",
    ]);
  });

  test("can open the form's question labels and message statuses, not edit the form", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    const as = t.withIdentity(REGISTRAR);
    await expect(as.query(api.registrationForms.get, { tournamentId: fx.tournamentId })).resolves.toMatchObject({ version: 0 });
    await expect(as.query(api.notifications.listForTournament, { tournamentId: fx.tournamentId })).resolves.toEqual([]);
    await expect(
      as.mutation(api.registrationForms.save, { tournamentId: fx.tournamentId, questions: [], expectedVersion: 0 }),
    ).rejects.toThrow(NO_ACCESS);
  });

  test("can't run the auction or manage the tournament", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    const as = t.withIdentity(REGISTRAR);
    await expect(as.mutation(api.tournaments.update, { id: fx.tournamentId, name: "Mine now" })).rejects.toThrow(NO_ACCESS);
    await expect(as.mutation(api.tournaments.setRegistrationFee, { tournamentId: fx.tournamentId, fee: 0 })).rejects.toThrow(NO_ACCESS);
    await expect(
      as.mutation(api.players.create, { tournamentId: fx.tournamentId, name: "Sneak", age: 22, role: ["Bowler"], battingBowlingHand: "Right-handed" }),
    ).rejects.toThrow(NO_ACCESS);
    await expect(as.mutation(api.staff.add, { tournamentId: fx.tournamentId, email: "x@test.com", role: "owner" })).rejects.toThrow(NO_ACCESS);
    await expect(as.mutation(api.auctions.createAuctionRoom, { tournamentId: fx.tournamentId, name: "R" })).rejects.toThrow(NO_ACCESS);
    await expect(as.query(api.registrations.listRefundsDue, { tournamentId: fx.tournamentId })).rejects.toThrow(NO_ACCESS);
    await expect(as.query(api.plans.getPlanUsage, { tournamentId: fx.tournamentId })).rejects.toThrow(NO_ACCESS);
  });

  test("gets the public tournament fields, not the plan or payment reference", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    const doc = await t.withIdentity(REGISTRAR).query(api.tournaments.getById, { id: fx.tournamentId });
    expect(doc).toMatchObject({ name: "Coastal Cup" });
    expect(doc).not.toHaveProperty("plan");
    // Still visible to them while the tournament is deactivated.
    await t.run((ctx) => ctx.db.patch(fx.tournamentId, { isActive: false }));
    expect(await t.withIdentity(REGISTRAR).query(api.tournaments.getById, { id: fx.tournamentId })).not.toBeNull();
  });

  test("policy: registrars don't run the auction or upload images", () => {
    expect(runsAuction("registrar")).toBe(false);
    expect(runsAuction("auctioneer")).toBe(true);
    expect(runsAuction("owner")).toBe(true);
    expect(runsAuction("super_admin")).toBe(true);
    expect(runsAuction(null)).toBe(false);
    const registrar = { isAdmin: false, canCreateTournament: false, staffRoles: ["registrar" as const] };
    for (const folder of ["players", "teams", "tournaments"]) expect(canUploadToFolder(registrar, folder)).toBe(false);
    const auctioneer = { isAdmin: false, canCreateTournament: false, staffRoles: ["auctioneer" as const] };
    expect(canUploadToFolder(auctioneer, "players")).toBe(true);
  });
});

describe("staff invites for people without an account", () => {
  test("an unknown address is invited and emailed; signing in with it grants the role", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    const asOwner = t.withIdentity(OWNER);

    const res = await asOwner.mutation(api.staff.add, { tournamentId: fx.tournamentId, email: " Newbie@Test.com ", role: "registrar" });
    expect(res).toMatchObject({ status: "invited" });
    const invites = await asOwner.query(api.staff.listInvites, { tournamentId: fx.tournamentId });
    expect(invites).toEqual([expect.objectContaining({ email: NEWBIE.email, role: "registrar" })]);
    const emails = await t.run((ctx) => ctx.db.query("emails").collect());
    expect(emails).toEqual([expect.objectContaining({ kind: "staff_added", to: NEWBIE.email })]);

    // They sign up later; their first sign-in claims the invite.
    const asNewbie = t.withIdentity(NEWBIE);
    expect(await asNewbie.query(api.tournaments.myRole, { tournamentId: fx.tournamentId })).toBeNull();
    await asNewbie.mutation(api.auth.ensureUser, {});
    expect(await asNewbie.query(api.tournaments.myRole, { tournamentId: fx.tournamentId })).toBe("registrar");
    expect(await asOwner.query(api.staff.listInvites, { tournamentId: fx.tournamentId })).toEqual([]);
    // Signing in again doesn't add a second row.
    await asNewbie.mutation(api.auth.ensureUser, {});
    expect((await staffRows(t, fx.tournamentId)).filter((s) => s.role === "registrar")).toHaveLength(2);
  });

  test("an address that has an account gets the same answer and is granted on their next visit", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    const res = await t.withIdentity(OWNER).mutation(api.staff.add, { tournamentId: fx.tournamentId, email: OUTSIDER.email, role: "auctioneer" });
    expect(res).toMatchObject({ status: "invited" });
    await t.withIdentity(OUTSIDER).mutation(api.auth.ensureUser, {});
    expect(await t.withIdentity(OUTSIDER).query(api.tournaments.myRole, { tournamentId: fx.tournamentId })).toBe("auctioneer");
  });

  test("an owner invite makes them an owner", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    await t.withIdentity(OWNER).mutation(api.staff.add, { tournamentId: fx.tournamentId, email: NEWBIE.email, role: "owner" });
    await t.withIdentity(NEWBIE).mutation(api.auth.ensureUser, {});
    expect(await t.withIdentity(NEWBIE).query(api.tournaments.myRole, { tournamentId: fx.tournamentId })).toBe("owner");
  });

  test("a revoked invite grants nothing; a second pending invite is refused", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    const res = await asOwner.mutation(api.staff.add, { tournamentId: fx.tournamentId, email: NEWBIE.email, role: "registrar" });
    if (res.status !== "invited") throw new Error("expected an invite");
    await expect(
      asOwner.mutation(api.staff.add, { tournamentId: fx.tournamentId, email: NEWBIE.email, role: "auctioneer" }),
    ).rejects.toThrow(/already invited/);
    await expect(t.withIdentity(REGISTRAR).mutation(api.staff.revokeInvite, { inviteId: res.inviteId })).rejects.toThrow(NO_ACCESS);
    await asOwner.mutation(api.staff.revokeInvite, { inviteId: res.inviteId });
    await t.withIdentity(NEWBIE).mutation(api.auth.ensureUser, {});
    expect(await t.withIdentity(NEWBIE).query(api.tournaments.myRole, { tournamentId: fx.tournamentId })).toBeNull();
  });

  test("someone already on the staff is refused", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    await expect(
      t.withIdentity(OWNER).mutation(api.staff.add, { tournamentId: fx.tournamentId, email: REGISTRAR.email, role: "auctioneer" }),
    ).rejects.toThrow(/already a registration admin/);
  });

  test("an invalid address is refused with a clear message", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    await expect(
      t.withIdentity(OWNER).mutation(api.staff.add, { tournamentId: fx.tournamentId, email: "not-an-email", role: "auctioneer" }),
    ).rejects.toThrow(/valid email address/);
  });

  test("a deactivated account doesn't claim invites", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    await t.withIdentity(OWNER).mutation(api.staff.add, { tournamentId: fx.tournamentId, email: OUTSIDER.email, role: "owner" });
    await t.run(async (ctx) => {
      const u = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", OUTSIDER.email)).first();
      await ctx.db.patch(u!._id, { deactivatedAt: Date.now() });
    });
    await t.withIdentity(OUTSIDER).mutation(api.auth.ensureUser, {});
    expect((await staffRows(t, fx.tournamentId)).some((s) => s.role === "owner" && s.userId !== fx.owner)).toBe(false);
  });

  test("deleting the tournament deletes its pending invites", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    await t.withIdentity(OWNER).mutation(api.staff.add, { tournamentId: fx.tournamentId, email: NEWBIE.email, role: "registrar" });
    await t.withIdentity(OWNER).mutation(api.tournaments.deleteTournament, { id: fx.tournamentId, confirmName: "Coastal Cup" });
    expect(await t.run((ctx) => ctx.db.query("staffInvites").collect())).toEqual([]);
  });
});

describe("registration fee switch", () => {
  test("owners make registration free or paid; the public form follows", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.tournaments.setRegistrationFee, { tournamentId: fx.tournamentId, fee: 0 });
    expect(await t.query(api.registrations.getPublicInfo, { tournamentId: fx.tournamentId })).toMatchObject({ fee: 0 });
    await asOwner.mutation(api.tournaments.setRegistrationFee, { tournamentId: fx.tournamentId, fee: 350 });
    expect(await t.query(api.registrations.getPublicInfo, { tournamentId: fx.tournamentId })).toMatchObject({ fee: 350 });
    const logs = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(logs.filter((l) => l.action === "set_registration_fee")).toHaveLength(2);
  });

  test("a fee must be whole rupees and not negative", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    await expect(asOwner.mutation(api.tournaments.setRegistrationFee, { tournamentId: fx.tournamentId, fee: -5 })).rejects.toThrow();
    await expect(asOwner.mutation(api.tournaments.setRegistrationFee, { tournamentId: fx.tournamentId, fee: 10.5 })).rejects.toThrow();
  });

  test("a completed tournament can't change its fee", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    await t.run((ctx) => ctx.db.patch(fx.tournamentId, { status: "completed" }));
    await expect(
      t.withIdentity(OWNER).mutation(api.tournaments.setRegistrationFee, { tournamentId: fx.tournamentId, fee: 0 }),
    ).rejects.toThrow(/completed/);
  });
});

describe("organisation logo", () => {
  test("owners set and remove it; the public form shows it", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.tournaments.update, { id: fx.tournamentId, organizationLogoUrl: LOGO });
    expect(await t.query(api.registrations.getPublicInfo, { tournamentId: fx.tournamentId })).toMatchObject({ organizationLogoUrl: LOGO });
    await asOwner.mutation(api.tournaments.update, { id: fx.tournamentId, organizationLogoUrl: "" });
    const info = await t.query(api.registrations.getPublicInfo, { tournamentId: fx.tournamentId });
    expect(info?.organizationLogoUrl).toBeUndefined();
  });

  test("must be our own upload", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    await expect(
      t.withIdentity(OWNER).mutation(api.tournaments.update, { id: fx.tournamentId, organizationLogoUrl: "https://evil.example/x.png" }),
    ).rejects.toThrow(/logo button/);
  });
});

describe("user-facing errors", () => {
  test("rule failures are ConvexErrors, so production shows the message, not 'Server Error'", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    const err = await t
      .withIdentity(OWNER)
      .mutation(api.registrations.approve, { registrationId: fx.unpaid })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<string>).data).toBe("Not paid yet");
  });

  test("access checks are ConvexErrors too", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    const err = await t
      .withIdentity(OUTSIDER)
      .mutation(api.registrations.approve, { registrationId: fx.ready })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<string>).data).toMatch(NO_ACCESS);
  });
});

describe("registration summary (tournament page badge)", () => {
  test("counts what's waiting for review and for payment; reviewers only", async () => {
    const t = convexTest(schema, modules);
    const fx = await setup(t);
    expect(await t.withIdentity(REGISTRAR).query(api.registrations.summary, { tournamentId: fx.tournamentId })).toEqual({
      ready: 2,
      awaitingPayment: 1,
      fee: 200,
    });
    await expect(t.withIdentity(OUTSIDER).query(api.registrations.summary, { tournamentId: fx.tournamentId })).rejects.toThrow(NO_ACCESS);
  });
});
