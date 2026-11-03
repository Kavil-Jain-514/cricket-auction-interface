/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc } from "./_generated/dataModel";
import { canCreateTournament, canUploadTournamentLogo, intentOf, type TournamentAccess } from "./policy";

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
