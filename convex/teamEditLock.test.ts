/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

// Team owners edit their own team's details until the auction starts.
// Fixtures follow auctions.test.ts (see there for why _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const SUPER = { email: "super@test.com", subject: "super|1" };
const ORGANISER = { email: "org@test.com", subject: "org|1" };
const OWNER_A = { email: "owner-a@test.com", subject: "oa|1" };
const OWNER_B = { email: "owner-b@test.com", subject: "ob|1" };
const STRANGER = { email: "stranger@test.com", subject: "s|1" };

const LOCKED = /locked because the auction has started/;
const NO_ACCESS = /access to this tournament/;

type T = ReturnType<typeof convexTest>;

/** A tournament with two teams, each with an owner member, and a waiting room. */
async function seed(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const user = (email: string, role?: "admin") => ctx.db.insert("users", { email, role, createdAt: now });
    await user(SUPER.email, "admin");
    const organiser = await user(ORGANISER.email);
    const ownerA = await user(OWNER_A.email);
    const ownerB = await user(OWNER_B.email);
    await user(STRANGER.email);

    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Lock Cup",
      createdBy: organiser,
      status: "setup",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5, basePrice: 100_000 },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: organiser, role: "owner", createdAt: now });

    const team = (name: string) =>
      ctx.db.insert("teams", {
        tournamentId,
        name,
        ownerName: "Owner",
        purseRemaining: 1_000_000,
        purseSpent: 0,
        colorPrimary: "#111111",
        colorSecondary: "#222222",
        createdAt: now,
        updatedAt: now,
      });
    const teamA = await team("Alpha");
    const teamB = await team("Bravo");
    await ctx.db.insert("teamMembers", { teamId: teamA, tournamentId, userId: ownerA, role: "owner", createdAt: now });
    await ctx.db.insert("teamMembers", { teamId: teamB, tournamentId, userId: ownerB, role: "owner", createdAt: now });

    const playerId = await ctx.db.insert("players", {
      tournamentId,
      name: "Pending",
      age: 25,
      role: ["Batter"],
      battingBowlingHand: "Right-handed",
      auctionStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Main",
      status: "waiting",
      createdBy: organiser,
      createdAt: now,
      updatedAt: now,
    });
    return { tournamentId, teamA, teamB, roomId, playerId };
  });
}

const setRoomStatus = (t: T, roomId: Id<"auctionRooms">, status: Doc<"auctionRooms">["status"]) =>
  t.run((ctx) => ctx.db.patch(roomId, { status }));
const teamName = (t: T, teamId: Id<"teams">) => t.run(async (ctx) => (await ctx.db.get(teamId))?.name);

describe("team owner edits before the auction starts", () => {
  test("an owner edits their own team's details while the room is waiting", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await t.withIdentity(OWNER_A).mutation(api.teams.update, {
      id: fx.teamA,
      name: "Alpha Kings",
      ownerName: "Asha",
      sponsorName: "Acme",
      logoUrl: "https://res.cloudinary.com/demo/image/upload/a.png",
      colorPrimary: "#ff0000",
      colorSecondary: "#00ff00",
    });
    const team = await t.run((ctx) => ctx.db.get(fx.teamA));
    expect(team).toMatchObject({ name: "Alpha Kings", ownerName: "Asha", sponsorName: "Acme", colorPrimary: "#ff0000" });
  });

  test("an owner edits before any auction room exists", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await t.run((ctx) => ctx.db.delete(fx.roomId));
    await t.withIdentity(OWNER_A).mutation(api.teams.update, { id: fx.teamA, name: "No Room Yet" });
    expect(await teamName(t, fx.teamA)).toBe("No Room Yet");
  });

  test("every owner edit is in the audit log", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await t.withIdentity(OWNER_A).mutation(api.teams.update, { id: fx.teamA, name: "Logged" });
    const logs = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(logs.find((l) => l.action === "update_team")).toMatchObject({ userEmail: OWNER_A.email, targetId: fx.teamA });
  });

  test("an owner can't change the captain", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await expect(
      t.withIdentity(OWNER_A).mutation(api.teams.update, { id: fx.teamA, captainPlayerId: fx.playerId }),
    ).rejects.toThrow(/Only the organiser can change the captain/);
    await expect(
      t.withIdentity(OWNER_A).mutation(api.teams.update, { id: fx.teamA, captainName: "Someone" }),
    ).rejects.toThrow(/Only the organiser can change the captain/);
  });

  test("an owner's edits pass the same checks as a team request", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const asA = t.withIdentity(OWNER_A);
    await expect(asA.mutation(api.teams.update, { id: fx.teamA, colorPrimary: "red" })).rejects.toThrow(/hex colours/);
    await expect(asA.mutation(api.teams.update, { id: fx.teamA, logoUrl: "javascript:alert(1)" })).rejects.toThrow(/upload button/);
    await expect(asA.mutation(api.teams.update, { id: fx.teamA, name: "Bravo" })).rejects.toThrow(/already exists/);
  });

  test("an owner can't edit another owner's team", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await expect(t.withIdentity(OWNER_A).mutation(api.teams.update, { id: fx.teamB, name: "Hijacked" })).rejects.toThrow(NO_ACCESS);
    await expect(t.withIdentity(STRANGER).mutation(api.teams.update, { id: fx.teamB, name: "Hijacked" })).rejects.toThrow(NO_ACCESS);
    await expect(t.mutation(api.teams.update, { id: fx.teamB, name: "Hijacked" })).rejects.toThrow();
    expect(await teamName(t, fx.teamB)).toBe("Bravo");
  });

  test("a deactivated owner can't edit", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await t.run(async (ctx) => {
      const u = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", OWNER_A.email)).first();
      await ctx.db.patch(u!._id, { deactivatedAt: Date.now() });
    });
    await expect(t.withIdentity(OWNER_A).mutation(api.teams.update, { id: fx.teamA, name: "Ghost" })).rejects.toThrow();
    expect(await teamName(t, fx.teamA)).toBe("Alpha");
  });
});

describe("team owner edits after the auction starts", () => {
  test("the organiser starting the auction locks the owner's next save, unchanged", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await t.withIdentity(ORGANISER).mutation(api.auctions.startAuction, { auctionRoomId: fx.roomId });
    await expect(t.withIdentity(OWNER_A).mutation(api.teams.update, { id: fx.teamA, name: "Too Late" })).rejects.toThrow(LOCKED);
    const team = await t.run((ctx) => ctx.db.get(fx.teamA));
    expect(team).toMatchObject({ name: "Alpha", updatedAt: expect.any(Number) });
    const logs = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(logs.some((l) => l.action === "update_team")).toBe(false);
  });

  test.each(["live", "paused", "completed"] as const)("a %s room locks owner edits", async (status) => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await setRoomStatus(t, fx.roomId, status);
    await expect(t.withIdentity(OWNER_A).mutation(api.teams.update, { id: fx.teamA, colorPrimary: "#333333" })).rejects.toThrow(LOCKED);
  });

  test("restarting the auction (room back to waiting) unlocks owner edits", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await setRoomStatus(t, fx.roomId, "live");
    await setRoomStatus(t, fx.roomId, "waiting");
    await t.withIdentity(OWNER_A).mutation(api.teams.update, { id: fx.teamA, name: "Second Go" });
    expect(await teamName(t, fx.teamA)).toBe("Second Go");
  });

  test("the organiser and a super-admin still edit any team while live", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await setRoomStatus(t, fx.roomId, "live");
    await t.withIdentity(ORGANISER).mutation(api.teams.update, { id: fx.teamA, name: "Organiser Edit" });
    expect(await teamName(t, fx.teamA)).toBe("Organiser Edit");
    await t.withIdentity(SUPER).mutation(api.teams.update, { id: fx.teamB, name: "Super Edit", captainPlayerId: fx.playerId });
    expect(await teamName(t, fx.teamB)).toBe("Super Edit");
  });
});

describe("teams:getMine", () => {
  test("returns the owner's team and whether editing is locked", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const asA = t.withIdentity(OWNER_A);
    expect(await asA.query(api.teams.getMine, { tournamentId: fx.tournamentId })).toMatchObject({
      team: { _id: fx.teamA, name: "Alpha" },
      editLocked: false,
    });
    await setRoomStatus(t, fx.roomId, "live");
    expect(await asA.query(api.teams.getMine, { tournamentId: fx.tournamentId })).toMatchObject({ editLocked: true });
  });

  test("is null for anyone who owns no team here, signed in or not", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    expect(await t.withIdentity(STRANGER).query(api.teams.getMine, { tournamentId: fx.tournamentId })).toBeNull();
    expect(await t.withIdentity(ORGANISER).query(api.teams.getMine, { tournamentId: fx.tournamentId })).toBeNull();
    expect(await t.query(api.teams.getMine, { tournamentId: fx.tournamentId })).toBeNull();
  });
});
