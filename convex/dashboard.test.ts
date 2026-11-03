/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

// Role-based dashboard listings (phase 3). Fixtures follow auctions.test.ts
// (see there for why _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const SUPER = { email: "super@test.com", subject: "super|1" };
const ORG = { email: "org@test.com", subject: "org|1" };
const OWNER = { email: "owner@test.com", subject: "owner|1" };

const SETTINGS = { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5 };
const PAGE = { numItems: 50, cursor: null };

type T = ReturnType<typeof convexTest>;

async function seed(t: T) {
  return await t.run(async (ctx) => {
    let now = 1_000;
    const user = (email: string, fields: Partial<Doc<"users">> = {}) => ctx.db.insert("users", { email, createdAt: now, ...fields });
    const superId = await user(SUPER.email, { role: "admin" });
    const org = await user(ORG.email, { accountType: "organiser", accountTypeChosenAt: 1 });
    const owner = await user(OWNER.email, { accountType: "team_owner", accountTypeChosenAt: 1 });

    const tournament = async (name: string, status: Doc<"tournaments">["status"], fields: Partial<Doc<"tournaments">> = {}) => {
      now += 1;
      return await ctx.db.insert("tournaments", { name, createdBy: superId, status, settings: SETTINGS, createdAt: now, updatedAt: now, ...fields });
    };
    const draft = await tournament("Draft Cup", "draft");
    const setup = await tournament("Setup Cup", "setup");
    const active = await tournament("Active Cup", "active");
    const live = await tournament("Live Cup", "active");
    const rehearsing = await tournament("Rehearsal Cup", "active");
    const done = await tournament("Done Cup", "completed");
    const hidden = await tournament("Hidden Cup", "active", { isActive: false });

    const room = (tournamentId: Id<"tournaments">, status: Doc<"auctionRooms">["status"], rehearsal?: boolean) =>
      ctx.db.insert("auctionRooms", { tournamentId, name: "Room", status, rehearsal, createdBy: superId, createdAt: now, updatedAt: now });
    await room(live, "live");
    await room(rehearsing, "live", true);
    await room(active, "waiting");
    await room(hidden, "paused");

    await ctx.db.insert("tournamentStaff", { tournamentId: setup, userId: org, role: "owner", createdAt: now });
    await ctx.db.insert("tournamentStaff", { tournamentId: hidden, userId: org, role: "auctioneer", createdAt: now });

    const teamId = await ctx.db.insert("teams", {
      tournamentId: active,
      name: "Strikers",
      ownerName: "Owen",
      purseRemaining: 1_000_000,
      purseSpent: 0,
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("teamMembers", { teamId, tournamentId: active, userId: owner, role: "owner", createdAt: now });
    await ctx.db.insert("teamRequests", {
      tournamentId: draft,
      userId: owner,
      name: "Waiting XI",
      ownerName: "Owen",
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      status: "pending",
      createdAt: now,
    });
    return { draft, setup, active, live, rehearsing, done, hidden };
  });
}

const names = (page: Array<{ name: string }>) => page.map((t) => t.name);

describe("tournaments.listPublic", () => {
  test("needs no sign-in, hides deactivated tournaments, and splits live from the rest", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const live = await t.query(api.tournaments.listPublic, { status: "live", paginationOpts: PAGE });
    expect(names(live.page)).toEqual(["Live Cup"]);
    expect(live.page[0].isLive).toBe(true);

    // Everything else, newest first, live ones excluded (they're shown on top).
    const rest = await t.query(api.tournaments.listPublic, { paginationOpts: PAGE });
    expect(names(rest.page)).toEqual(["Done Cup", "Rehearsal Cup", "Active Cup", "Setup Cup", "Draft Cup"]);
    expect(rest.page.every((c) => !c.isLive)).toBe(true);

    const upcoming = await t.query(api.tournaments.listPublic, { status: "upcoming", paginationOpts: PAGE });
    expect(names(upcoming.page)).toEqual(["Rehearsal Cup", "Active Cup", "Setup Cup", "Draft Cup"]);
    const completed = await t.query(api.tournaments.listPublic, { status: "completed", paginationOpts: PAGE });
    expect(names(completed.page)).toEqual(["Done Cup"]);
  });

  test("pages with a cursor and returns only card fields", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const first = await t.query(api.tournaments.listPublic, { paginationOpts: { numItems: 2, cursor: null } });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    const second = await t.query(api.tournaments.listPublic, { paginationOpts: { numItems: 10, cursor: first.continueCursor } });
    expect(names([...first.page, ...second.page])).toEqual(["Done Cup", "Rehearsal Cup", "Active Cup", "Setup Cup", "Draft Cup"]);
    // No organiser-only settings (payment QR, fees, rules) on a public card.
    const allowed = ["_id", "basePurse", "createdAt", "description", "isActive", "isLive", "logoUrl", "maxPlayersPerTeam", "name", "status"];
    for (const card of first.page) expect(Object.keys(card).every((k) => allowed.includes(k))).toBe(true);
  });
});

describe("role listings", () => {
  test("listMinePaged: the organiser's staff tournaments with their role, deactivated included", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const mine = await t.withIdentity(ORG).query(api.tournaments.listMinePaged, { paginationOpts: PAGE });
    expect(mine.page.map((c) => [c.name, c.myRole, c.isLive])).toEqual([
      ["Hidden Cup", "auctioneer", true], // paused room = still running
      ["Setup Cup", "owner", false],
    ]);
    expect((await t.query(api.tournaments.listMinePaged, { paginationOpts: PAGE })).page).toEqual([]);
  });

  test("listForAdmin: super-admin only, deactivated included, status filter", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect((await t.withIdentity(ORG).query(api.tournaments.listForAdmin, { paginationOpts: PAGE })).page).toEqual([]);
    // Unfiltered = everything not live (the dashboard shows live ones on top).
    const rest = await t.withIdentity(SUPER).query(api.tournaments.listForAdmin, { paginationOpts: PAGE });
    expect(rest.page).toHaveLength(5);
    const live = await t.withIdentity(SUPER).query(api.tournaments.listForAdmin, { status: "live", paginationOpts: PAGE });
    expect(names(live.page).sort()).toEqual(["Hidden Cup", "Live Cup"]);
    const inactive = await t.withIdentity(SUPER).query(api.tournaments.listForAdmin, { status: "inactive", paginationOpts: PAGE });
    expect(names(inactive.page)).toEqual(["Hidden Cup"]);
  });

  test("listForTeamOwner: only tournaments where they own a team or have a request", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const rows = await t.withIdentity(OWNER).query(api.tournaments.listForTeamOwner, {});
    expect(rows.map((r) => [r.name, r.teamName, r.teamStatus])).toEqual([
      ["Active Cup", "Strikers", "owner"],
      ["Draft Cup", "Waiting XI", "pending"],
    ]);
    expect(await t.withIdentity(ORG).query(api.tournaments.listForTeamOwner, {})).toEqual([]);
  });
});
