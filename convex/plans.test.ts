/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { PLAN_TIERS, planLimits } from "./plans";

// Step 16b: per-tournament plans and limits. Fixtures follow auctions.test.ts.
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const SUPER = { email: "super@test.com", subject: "super|1" };
const ORG = { email: "org@test.com", subject: "org|1" };

const SETTINGS = { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5 };
const player = (i: number) => ({ name: `Player ${i}`, age: 22, role: ["Batter"], battingBowlingHand: "Right-handed" as const });
const team = (tournamentId: Id<"tournaments">, i: number) => ({
  tournamentId,
  name: `Team ${i}`,
  ownerName: "Owner",
  colorPrimary: "#000000",
  colorSecondary: "#ffffff",
});

async function users(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { email: SUPER.email, role: "admin", createdAt: Date.now() });
    await ctx.db.insert("users", { email: ORG.email, createdAt: Date.now() });
  });
}

describe("plan tiers", () => {
  test("the agreed tiers", () => {
    expect(PLAN_TIERS).toMatchObject({
      free: { price: 0, maxTeams: 4, maxPlayers: 60 },
      club: { price: 999, maxTeams: 8, maxPlayers: 150 },
      league: { price: 2999, maxTeams: 12, maxPlayers: 250 },
      pro: { price: 6999, maxTeams: 20, maxPlayers: 500 },
    });
  });

  test("no plan (tournaments from before plans) is unlimited", () => {
    expect(planLimits({})).toBeNull();
    expect(planLimits({ plan: { tier: "club", maxTeams: 8, maxPlayers: 150 } })).toEqual({ maxTeams: 8, maxPlayers: 150 });
  });
});

describe("plan limits", () => {
  test("a new tournament starts on Free and can't add a fifth team", async () => {
    const t = convexTest(schema, modules);
    await users(t);
    const asOrg = t.withIdentity(ORG);
    const id = await asOrg.mutation(api.tournaments.create, { name: "Trial Cup", settings: SETTINGS });
    expect((await t.run((ctx) => ctx.db.get(id)))?.plan).toMatchObject({ tier: "free", maxTeams: 4, maxPlayers: 60 });

    for (let i = 1; i <= 4; i++) await asOrg.mutation(api.teams.create, team(id, i));
    await expect(asOrg.mutation(api.teams.create, team(id, 5))).rejects.toThrow(/Free plan allows 4 teams/);
  });

  test("players are capped on create and bulk import, and nothing partial is imported", async () => {
    const t = convexTest(schema, modules);
    await users(t);
    const asOrg = t.withIdentity(ORG);
    const id = await asOrg.mutation(api.tournaments.create, { name: "Trial Cup", settings: SETTINGS });

    const res = await asOrg.mutation(api.players.bulkImport, { tournamentId: id, players: Array.from({ length: 59 }, (_, i) => player(i)) });
    expect(res).toMatchObject({ success: true, count: 59 });
    await expect(
      asOrg.mutation(api.players.bulkImport, { tournamentId: id, players: [player(100), player(101)] }),
    ).rejects.toThrow(/Free plan allows 60 players/);
    await asOrg.mutation(api.players.create, { tournamentId: id, ...player(60) });
    await expect(asOrg.mutation(api.players.create, { tournamentId: id, ...player(61) })).rejects.toThrow(/60 players/);
    expect(await t.run((ctx) => ctx.db.query("players").collect())).toHaveLength(60);
  });

  test("tournaments created before plans stay unlimited", async () => {
    const t = convexTest(schema, modules);
    await users(t);
    const id = await t.run(async (ctx) => {
      const orgId = (await ctx.db.query("users").collect()).find((u) => u.email === ORG.email)!._id;
      const tid = await ctx.db.insert("tournaments", {
        name: "Legacy",
        createdBy: orgId,
        status: "active",
        settings: SETTINGS,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as Omit<Doc<"tournaments">, "_id" | "_creationTime">);
      await ctx.db.insert("tournamentStaff", { tournamentId: tid, userId: orgId, role: "owner", createdAt: Date.now() });
      return tid;
    });
    const asOrg = t.withIdentity(ORG);
    for (let i = 1; i <= 5; i++) await asOrg.mutation(api.teams.create, team(id, i));
    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toHaveLength(5);
  });

  test("grantPlan: super-admin only; raises the limits", async () => {
    const t = convexTest(schema, modules);
    await users(t);
    const asOrg = t.withIdentity(ORG);
    const id = await asOrg.mutation(api.tournaments.create, { name: "Trial Cup", settings: SETTINGS });

    await expect(asOrg.mutation(api.plans.grantPlan, { tournamentId: id, tier: "pro", reason: "x" })).rejects.toThrow(/Admin access required/);
    await t.withIdentity(SUPER).mutation(api.plans.grantPlan, { tournamentId: id, tier: "club", reason: "Paid by bank transfer" });
    expect((await t.run((ctx) => ctx.db.get(id)))?.plan).toMatchObject({ tier: "club", maxTeams: 8, paymentRef: "manual: Paid by bank transfer" });
    for (let i = 1; i <= 5; i++) await asOrg.mutation(api.teams.create, team(id, i));
  });

  test("getPlanUsage reports counts against the limits for the owner", async () => {
    const t = convexTest(schema, modules);
    await users(t);
    const asOrg = t.withIdentity(ORG);
    const id = await asOrg.mutation(api.tournaments.create, { name: "Trial Cup", settings: SETTINGS });
    await asOrg.mutation(api.teams.create, team(id, 1));
    await asOrg.mutation(api.players.create, { tournamentId: id, ...player(1) });
    expect(await asOrg.query(api.plans.getPlanUsage, { tournamentId: id })).toMatchObject({
      tier: "free",
      teams: 1,
      players: 1,
      maxTeams: 4,
      maxPlayers: 60,
    });
  });
});
