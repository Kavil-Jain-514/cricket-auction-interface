/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc } from "./_generated/dataModel";
import { canCreateTournament, canUploadToFolder, canUploadTournamentLogo, intentOf, type TournamentAccess, type Uploader } from "./policy";

// Signup intent and the account-level policy (organiser / team owner / viewer).
// Fixtures follow auctions.test.ts (see there for why _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const SUPER = { email: "super@test.com", subject: "super|1" };
const USER = { email: "user@test.com", subject: "user|1" };

const SETTINGS = { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5 };

type User = Doc<"users">;
const user = (fields: Partial<User>): User =>
  ({ _id: "u" as User["_id"], _creationTime: 0, email: "x@test.com", createdAt: 0, ...fields }) as User;

describe("policy", () => {
  test("an intent counts only once it was chosen after the roles change", () => {
    expect(intentOf(user({}))).toBeNull();
    // Legacy choice from before organiser existed: asked again.
    expect(intentOf(user({ accountType: "team_owner" }))).toBeNull();
    expect(intentOf(user({ accountType: "team_owner", accountTypeChosenAt: 1 }))).toBe("team_owner");
    expect(intentOf(user({ accountType: "organiser", accountTypeChosenAt: 1 }))).toBe("organiser");
  });

  test("canCreateTournament: organisers and the super-admin only", () => {
    const chosen = (accountType: User["accountType"]) => user({ accountType, accountTypeChosenAt: 1 });
    expect(canCreateTournament(chosen("organiser"))).toBe(true);
    expect(canCreateTournament(chosen("team_owner"))).toBe(false);
    expect(canCreateTournament(chosen("visitor"))).toBe(false);
    expect(canCreateTournament(user({}))).toBe(false);
    expect(canCreateTournament(user({ accountType: "organiser" }))).toBe(false);
    expect(canCreateTournament(user({ role: "admin" }))).toBe(true);
    expect(canCreateTournament(null)).toBe(false);
  });

  test("canUploadTournamentLogo: the tournament's owner and the super-admin only", () => {
    const matrix: Array<[TournamentAccess, boolean]> = [
      ["super_admin", true],
      ["owner", true],
      ["auctioneer", false],
      [null, false],
    ];
    for (const [access, allowed] of matrix) expect(canUploadTournamentLogo(access)).toBe(allowed);
  });
});

describe("signup intent", () => {
  async function seed(t: ReturnType<typeof convexTest>, fields: Partial<User> = {}) {
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { email: SUPER.email, role: "admin", createdAt: Date.now() });
      await ctx.db.insert("users", { email: USER.email, createdAt: Date.now(), ...fields });
    });
  }

  test("a legacy choice is asked again; a new one is kept", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { accountType: "visitor" });
    const asUser = t.withIdentity(USER);
    expect(await asUser.query(api.auth.me, {})).toMatchObject({ canCreateTournament: false });
    expect((await asUser.query(api.auth.me, {}))?.accountType).toBeUndefined();
    await asUser.mutation(api.auth.setAccountType, { accountType: "organiser" });
    expect(await asUser.query(api.auth.me, {})).toMatchObject({ accountType: "organiser", canCreateTournament: true });
  });

  test("a tampered role in the payload is rejected", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const asUser = t.withIdentity(USER);
    await expect(
      asUser.mutation(api.auth.setAccountType, { accountType: "admin" as "organiser" }),
    ).rejects.toThrow();
    const row = await t.run((ctx) => ctx.db.query("users").filter((q) => q.eq(q.field("email"), USER.email)).first());
    expect(row?.role).toBeUndefined();
    expect(row?.accountType).toBeUndefined();
  });

  test.each([
    ["no choice yet", {}],
    ["viewer", { accountType: "visitor" as const, accountTypeChosenAt: 1 }],
    ["team owner", { accountType: "team_owner" as const, accountTypeChosenAt: 1 }],
    ["legacy organiser-by-staff, not re-chosen", { accountType: "visitor" as const }],
  ])("tournaments.create refuses a %s", async (_label, fields) => {
    const t = convexTest(schema, modules);
    await seed(t, fields);
    await expect(
      t.withIdentity(USER).mutation(api.tournaments.create, { name: "Nope Cup", settings: SETTINGS }),
    ).rejects.toThrow(/Only organisers can create tournaments/);
    expect(await t.run((ctx) => ctx.db.query("tournaments").collect())).toHaveLength(0);
  });

  test("tournaments.create allows an organiser and the super-admin", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { accountType: "organiser", accountTypeChosenAt: 1 });
    await t.withIdentity(USER).mutation(api.tournaments.create, { name: "Org Cup", settings: SETTINGS });
    await t.withIdentity(SUPER).mutation(api.tournaments.create, { name: "Super Cup", settings: SETTINGS });
    expect(await t.run((ctx) => ctx.db.query("tournaments").collect())).toHaveLength(2);
  });
});

describe("team owner scoping", () => {
  const ORG = { email: "org@test.com", subject: "org|1" };
  const TEAM = { name: "Strikers", ownerName: "Owen", colorPrimary: "#111111", colorSecondary: "#222222" };

  async function seedTournament(t: ReturnType<typeof convexTest>, userFields: Partial<User> = {}) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const org = await ctx.db.insert("users", { email: ORG.email, accountType: "organiser", accountTypeChosenAt: 1, createdAt: now });
      await ctx.db.insert("users", { email: USER.email, createdAt: now, ...userFields });
      const tournamentId = await ctx.db.insert("tournaments", { name: "Cup", createdBy: org, status: "setup", settings: SETTINGS, createdAt: now, updatedAt: now });
      await ctx.db.insert("tournamentStaff", { tournamentId, userId: org, role: "owner", createdAt: now });
      const teamId = await ctx.db.insert("teams", { tournamentId, ...TEAM, purseRemaining: 1_000_000, purseSpent: 0, createdAt: now, updatedAt: now });
      return { tournamentId, teamId };
    });
  }

  test.each([
    ["no choice yet", {}],
    ["viewer", { accountType: "visitor" as const, accountTypeChosenAt: 1 }],
    ["organiser", { accountType: "organiser" as const, accountTypeChosenAt: 1 }],
  ])("teamRequests.submit refuses a %s", async (_label, fields) => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seedTournament(t, fields);
    await expect(
      t.withIdentity(USER).mutation(api.teamRequests.submit, { tournamentId, ...TEAM, name: "Mine" }),
    ).rejects.toThrow(/Only team owners can register a team/);
    expect(await t.run((ctx) => ctx.db.query("teamRequests").collect())).toHaveLength(0);
  });

  test("teamRequests.submit accepts a team owner", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seedTournament(t, { accountType: "team_owner", accountTypeChosenAt: 1 });
    await t.withIdentity(USER).mutation(api.teamRequests.submit, { tournamentId, ...TEAM, name: "Mine" });
    expect(await t.run((ctx) => ctx.db.query("teamRequests").collect())).toHaveLength(1);
  });

  test.each([
    ["no choice yet", {}, "team_owner"],
    ["viewer", { accountType: "visitor" as const, accountTypeChosenAt: 1 }, "team_owner"],
    ["organiser", { accountType: "organiser" as const, accountTypeChosenAt: 1 }, "organiser"],
  ])("claiming an owner invite as a %s sets the right intent", async (_label, fields, expected) => {
    const t = convexTest(schema, modules);
    const { teamId } = await seedTournament(t, fields);
    const { token } = await t.withIdentity(ORG).mutation(api.members.createInvite, { teamId });
    const asUser = t.withIdentity(USER);
    expect(await asUser.mutation(api.members.claimInvite, { token })).toMatchObject({ success: true });
    expect((await asUser.query(api.auth.me, {}))?.accountType).toBe(expected);
    // Single use: nobody else can claim the same link.
    const other = { email: "other@test.com", subject: "other|1" };
    expect(await t.withIdentity(other).mutation(api.members.claimInvite, { token })).toEqual({
      success: false,
      reason: "This invite was already used",
    });
  });

  test("a team owner with no team sees no tournaments; after claiming, only that one", async () => {
    const t = convexTest(schema, modules);
    const { teamId } = await seedTournament(t, { accountType: "team_owner", accountTypeChosenAt: 1 });
    const asUser = t.withIdentity(USER);
    expect(await asUser.query(api.tournaments.listForTeamOwner, {})).toEqual([]);
    const { token } = await t.withIdentity(ORG).mutation(api.members.createInvite, { teamId });
    await asUser.mutation(api.members.claimInvite, { token });
    expect((await asUser.query(api.tournaments.listForTeamOwner, {})).map((r) => r.teamName)).toEqual(["Strikers"]);
  });
});

describe("canUploadToFolder", () => {
  const who = (over: Partial<Uploader>): Uploader => ({ isAdmin: false, canCreateTournament: false, staffRoles: [], ...over });
  const cases: Array<[string, Uploader, Record<string, boolean>]> = [
    ["super-admin", who({ isAdmin: true }), { tournaments: true, teams: true, players: true }],
    ["organiser creating their first tournament", who({ accountType: "organiser", canCreateTournament: true }), { tournaments: true, teams: false, players: false }],
    ["a tournament's owner", who({ staffRoles: ["owner"] }), { tournaments: true, teams: true, players: true }],
    ["an auctioneer only", who({ staffRoles: ["auctioneer"] }), { tournaments: false, teams: true, players: true }],
    ["a team owner", who({ accountType: "team_owner" }), { tournaments: false, teams: true, players: false }],
    ["a viewer", who({ accountType: "visitor" }), { tournaments: false, teams: false, players: false }],
  ];
  test.each(cases)("%s", (_label, uploader, expected) => {
    for (const [folder, allowed] of Object.entries(expected)) expect([folder, canUploadToFolder(uploader, folder)]).toEqual([folder, allowed]);
  });
});

describe("tournament logo", () => {
  const OWNER = { email: "owner@test.com", subject: "owner|1" };
  const AUCTIONEER = { email: "auctioneer@test.com", subject: "auctioneer|1" };
  const LOGO = "https://res.cloudinary.com/demo/image/upload/v1/cricket-auction/tournaments/logo.png";

  async function seed(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const owner = await ctx.db.insert("users", { email: OWNER.email, accountType: "organiser", accountTypeChosenAt: 1, createdAt: now });
      const auctioneer = await ctx.db.insert("users", { email: AUCTIONEER.email, createdAt: now });
      await ctx.db.insert("users", { email: SUPER.email, role: "admin", createdAt: now });
      const id = await ctx.db.insert("tournaments", { name: "Logo Cup", createdBy: owner, status: "setup", settings: SETTINGS, createdAt: now, updatedAt: now });
      await ctx.db.insert("tournamentStaff", { tournamentId: id, userId: owner, role: "owner", createdAt: now });
      await ctx.db.insert("tournamentStaff", { tournamentId: id, userId: auctioneer, role: "auctioneer", createdAt: now });
      return id;
    });
  }

  test("the owner and the super-admin set it; an auctioneer can't", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    await t.withIdentity(OWNER).mutation(api.tournaments.update, { id, logoUrl: LOGO });
    await t.withIdentity(SUPER).mutation(api.tournaments.update, { id, logoUrl: LOGO.replace("logo", "logo2") });
    await expect(t.withIdentity(AUCTIONEER).mutation(api.tournaments.update, { id, logoUrl: LOGO })).rejects.toThrow(/access to this tournament/);
    expect((await t.run((ctx) => ctx.db.get(id)))?.logoUrl).toBe(LOGO.replace("logo", "logo2"));
  });

  test.each(["https://evil.example/logo.png", "javascript:alert(1)", "http://res.cloudinary.com/x/logo.png"])(
    "only uploaded images are accepted: %s",
    async (logoUrl) => {
      const t = convexTest(schema, modules);
      const id = await seed(t);
      await expect(t.withIdentity(OWNER).mutation(api.tournaments.update, { id, logoUrl })).rejects.toThrow(/Upload the logo/);
      await expect(
        t.withIdentity(OWNER).mutation(api.tournaments.create, { name: "Other Cup", logoUrl, settings: SETTINGS }),
      ).rejects.toThrow(/Upload the logo/);
    },
  );

  test("an unchanged legacy logo doesn't block other edits", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    await t.run((ctx) => ctx.db.patch(id, { logoUrl: "https://old-host.example/logo.png" }));
    await t.withIdentity(OWNER).mutation(api.tournaments.update, { id, name: "Renamed Cup", logoUrl: "https://old-host.example/logo.png" });
    expect((await t.run((ctx) => ctx.db.get(id)))?.name).toBe("Renamed Cup");
  });
});
