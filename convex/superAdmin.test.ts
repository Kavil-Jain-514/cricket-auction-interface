/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc } from "./_generated/dataModel";

// Phase 11: the super-admin's users page (filter, search, change intent,
// deactivate). Fixtures follow auctions.test.ts (see there for why
// _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const SUPER = { email: "super@test.com", subject: "super|1" };
const ORG = { email: "org@test.com", subject: "org|1" };
const PAGE = { numItems: 50, cursor: null };

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    let now = 1_000;
    const user = (email: string, fields: Partial<Doc<"users">> = {}) => ctx.db.insert("users", { email, createdAt: (now += 1), ...fields });
    const superId = await user(SUPER.email, { role: "admin" });
    const org = await user(ORG.email, { accountType: "organiser", accountTypeChosenAt: 1, name: "Olive Organiser" });
    const owner = await user("owner@test.com", { accountType: "team_owner", accountTypeChosenAt: 1 });
    const viewer = await user("viewer@test.com", { accountType: "visitor", accountTypeChosenAt: 1 });
    const legacy = await user("legacy@test.com", { accountType: "visitor" }); // chose before organisers existed
    const fresh = await user("fresh@test.com");
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Cup",
      createdBy: org,
      status: "setup",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5 },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: org, role: "owner", createdAt: now });
    return { superId, org, owner, viewer, legacy, fresh, tournamentId };
  });
}

const emails = (page: Array<{ email: string }>) => page.map((u) => u.email).sort();

describe("auth.listUsers", () => {
  test("super-admin only; filters by intent, admins, unchosen and deactivated", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    expect((await t.withIdentity(ORG).query(api.auth.listUsers, { paginationOpts: PAGE })).page).toEqual([]);
    const asSuper = t.withIdentity(SUPER);
    const list = (filter?: "organiser" | "team_owner" | "visitor" | "none" | "admin" | "deactivated") =>
      asSuper.query(api.auth.listUsers, { filter, paginationOpts: PAGE });

    expect((await list()).page).toHaveLength(6);
    expect(emails((await list("organiser")).page)).toEqual([ORG.email]);
    expect(emails((await list("visitor")).page)).toEqual(["viewer@test.com"]);
    expect(emails((await list("none")).page)).toEqual(["fresh@test.com", "legacy@test.com"]);
    expect(emails((await list("admin")).page)).toEqual([SUPER.email]);

    await asSuper.mutation(api.auth.setUserActive, { userId: ids.viewer, active: false });
    expect(emails((await list("deactivated")).page)).toEqual(["viewer@test.com"]);

    const row = (await list("organiser")).page[0];
    expect(row).toMatchObject({ name: "Olive Organiser", intent: "organiser", role: "user", tournaments: 1, deactivated: false });
  });

  test("search matches the start of an email, newest first, server-side", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const res = await t.withIdentity(SUPER).query(api.auth.listUsers, { search: "  OW", paginationOpts: PAGE });
    expect(emails(res.page)).toEqual(["owner@test.com"]);
    const none = await t.withIdentity(SUPER).query(api.auth.listUsers, { search: "zzz", paginationOpts: PAGE });
    expect(none.page).toEqual([]);
  });
});

describe("auth.setUserIntent", () => {
  test("the super-admin changes someone's intent; nobody else can", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await expect(t.withIdentity(ORG).mutation(api.auth.setUserIntent, { userId: ids.viewer, accountType: "organiser" })).rejects.toThrow(/Admin access required/);
    await t.withIdentity(SUPER).mutation(api.auth.setUserIntent, { userId: ids.viewer, accountType: "organiser" });
    expect(await t.withIdentity({ email: "viewer@test.com", subject: "v|1" }).query(api.auth.me, {})).toMatchObject({ accountType: "organiser", canCreateTournament: true });
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(audit.find((a) => a.action === "set_user_intent")).toMatchObject({ newData: { accountType: "organiser" } });
  });
});

describe("auth.setUserActive (deactivation)", () => {
  test("a deactivated account can't act anywhere, and me says so", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const asOrg = t.withIdentity(ORG);
    await t.withIdentity(SUPER).mutation(api.auth.setUserActive, { userId: ids.org, active: false });

    expect(await asOrg.query(api.auth.me, {})).toMatchObject({ isDeactivated: true, canCreateTournament: false, isAdmin: false });
    await expect(asOrg.mutation(api.tournaments.create, { name: "New Cup", settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5 } })).rejects.toThrow(/deactivated/);
    await expect(asOrg.mutation(api.teams.create, { tournamentId: ids.tournamentId, name: "X", ownerName: "Y", colorPrimary: "#000000", colorSecondary: "#ffffff" })).rejects.toThrow(/deactivated/);
    expect(await asOrg.query(api.tournaments.myRole, { tournamentId: ids.tournamentId })).toBeNull();
    // Signing in again doesn't create a fresh account around the block.
    await asOrg.mutation(api.auth.ensureUser, {});
    await expect(asOrg.mutation(api.teamRequests.submit, { tournamentId: ids.tournamentId, name: "X", ownerName: "Y", colorPrimary: "#000000", colorSecondary: "#ffffff" })).rejects.toThrow(/deactivated/);
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(6);

    await t.withIdentity(SUPER).mutation(api.auth.setUserActive, { userId: ids.org, active: true });
    expect(await asOrg.query(api.tournaments.myRole, { tournamentId: ids.tournamentId })).toBe("owner");
  });

  test("you can't deactivate yourself or another admin; it is audited", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const asSuper = t.withIdentity(SUPER);
    await expect(asSuper.mutation(api.auth.setUserActive, { userId: ids.superId, active: false })).rejects.toThrow(/yourself/);
    await t.run((ctx) => ctx.db.patch(ids.org, { role: "admin" }));
    await expect(asSuper.mutation(api.auth.setUserActive, { userId: ids.org, active: false })).rejects.toThrow(/Remove their admin role first/);
    await asSuper.mutation(api.auth.setUserActive, { userId: ids.viewer, active: false });
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(audit.find((a) => a.action === "deactivate_user")?.targetId).toBe(ids.viewer);
  });
});
