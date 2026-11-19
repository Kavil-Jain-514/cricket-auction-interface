/// <reference types="vite/client" />
// Image URLs must be files we uploaded (AUDIT 2026-11 SEC-004). These tests
// set the Convex env's cloud name, as production has it.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { assertImageUrl, isAllowedPlayerPhoto, isOurUpload } from "./uploads";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN = { email: "admin@test.com", subject: "admin|1" };
const OWNER = { email: "owner@test.com", subject: "owner|1" };
const OURS = (folder: string, file = "a.png") => `https://res.cloudinary.com/bid11/image/upload/v1/cricket-auction/${folder}/${file}`;
const OTHER_CLOUD = "https://res.cloudinary.com/attacker/image/upload/v1/cricket-auction/teams/a.png";
const OTHER_HOST = "https://attacker.example/pixel.png";

beforeEach(() => {
  process.env.CLOUDINARY_CLOUD_NAME = "bid11";
});
afterEach(() => {
  delete process.env.CLOUDINARY_CLOUD_NAME;
});

describe("isOurUpload", () => {
  test.each([
    ["our upload", OURS("teams"), true],
    ["our upload with a transformation", "https://res.cloudinary.com/bid11/image/upload/f_auto,q_auto/v1/cricket-auction/teams/a.png", true],
    ["another Cloudinary account", OTHER_CLOUD, false],
    ["outside our folder", "https://res.cloudinary.com/bid11/image/upload/v1/elsewhere/a.png", false],
    ["another host", OTHER_HOST, false],
    ["plain http", "http://res.cloudinary.com/bid11/image/upload/v1/cricket-auction/teams/a.png", false],
    ["script", "javascript:alert(1)", false],
    ["too long", OURS("teams", `${"a".repeat(600)}.png`), false],
  ])("%s", (_label, url, expected) => {
    expect(isOurUpload(url)).toBe(expected);
  });

  test("checks the folder when asked", () => {
    expect(isOurUpload(OURS("registrations"), "registrations")).toBe(true);
    expect(isOurUpload(OURS("teams"), "registrations")).toBe(false);
  });

  test("without a configured cloud only the Cloudinary host is checked (unconfigured deployments keep working)", () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    expect(isOurUpload(OTHER_CLOUD)).toBe(true);
    expect(isOurUpload(OTHER_HOST)).toBe(false);
  });

  test("player photos may also be Google Drive images from an import", () => {
    expect(isAllowedPlayerPhoto("https://lh3.googleusercontent.com/d/abc=w400")).toBe(true);
    expect(isAllowedPlayerPhoto(OURS("players"))).toBe(true);
    expect(isAllowedPlayerPhoto(OTHER_HOST)).toBe(false);
  });

  test("an unchanged value is accepted, so old records stay editable", () => {
    expect(() => assertImageUrl(OTHER_HOST, "no", { previous: OTHER_HOST })).not.toThrow();
    expect(() => assertImageUrl(OTHER_HOST, "no", { previous: "x" })).toThrow("no");
    expect(() => assertImageUrl(undefined, "no")).not.toThrow();
    expect(() => assertImageUrl("", "no")).not.toThrow();
  });
});

async function seed(t: ReturnType<typeof convexTest>, legacyLogo?: string) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", { email: ADMIN.email, role: "admin", createdAt: now });
    const ownerId = await ctx.db.insert("users", {
      email: OWNER.email,
      accountType: "team_owner",
      accountTypeChosenAt: now,
      createdAt: now,
    });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Upload Cup",
      createdBy: ownerId,
      status: "active",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5, registrationOpen: true },
      createdAt: now,
      updatedAt: now,
    });
    const teamId = await ctx.db.insert("teams", {
      tournamentId,
      name: "Owners XI",
      ownerName: "Owner",
      logoUrl: legacyLogo,
      purseRemaining: 1_000_000,
      purseSpent: 0,
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("teamMembers", { teamId, tournamentId, userId: ownerId, role: "owner", createdAt: now });
    await ctx.db.insert("auctionRooms", { tournamentId, name: "Room", status: "waiting", createdBy: ownerId, createdAt: now, updatedAt: now });
    return { tournamentId, teamId };
  });
}

describe("every image write path only accepts our uploads", () => {
  test("team owner's logo", async () => {
    const t = convexTest(schema, modules);
    const { teamId } = await seed(t);
    const asOwner = t.withIdentity(OWNER);
    for (const url of [OTHER_CLOUD, OTHER_HOST]) {
      await expect(asOwner.mutation(api.teams.update, { id: teamId, logoUrl: url })).rejects.toThrow(/upload button/);
    }
    await asOwner.mutation(api.teams.update, { id: teamId, logoUrl: OURS("teams") });
  });

  test("organiser's team create and update, logo and captain photo", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, teamId } = await seed(t);
    const asAdmin = t.withIdentity(ADMIN);
    const team = { tournamentId, ownerName: "Organiser", colorPrimary: "#111111", colorSecondary: "#222222" };
    await expect(asAdmin.mutation(api.teams.create, { ...team, name: "Bad", logoUrl: OTHER_HOST })).rejects.toThrow(/upload button/);
    await expect(asAdmin.mutation(api.teams.create, { ...team, name: "Bad", captainPhotoUrl: OTHER_HOST })).rejects.toThrow(/upload button/);
    await asAdmin.mutation(api.teams.create, { ...team, name: "Good", logoUrl: OURS("teams") });
    await expect(asAdmin.mutation(api.teams.update, { id: teamId, logoUrl: OTHER_CLOUD })).rejects.toThrow(/upload button/);
  });

  test("a team saved with an older external logo can still be edited without changing it", async () => {
    const t = convexTest(schema, modules);
    const { teamId } = await seed(t, OTHER_HOST);
    await t.withIdentity(OWNER).mutation(api.teams.update, { id: teamId, name: "Renamed XI", logoUrl: OTHER_HOST });
    expect((await t.run((ctx) => ctx.db.get(teamId)))?.name).toBe("Renamed XI");
  });

  test("team request logo", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    const asOther = t.withIdentity({ email: "req@test.com", subject: "req|1" });
    await t.run((ctx) =>
      ctx.db.insert("users", { email: "req@test.com", accountType: "team_owner", accountTypeChosenAt: Date.now(), createdAt: Date.now() }),
    );
    const request = { tournamentId, name: "New XI", ownerName: "Requester", colorPrimary: "#111111", colorSecondary: "#222222" };
    await expect(asOther.mutation(api.teamRequests.submit, { ...request, logoUrl: OTHER_CLOUD })).rejects.toThrow(/upload button/);
    await asOther.mutation(api.teamRequests.submit, { ...request, logoUrl: OURS("teams") });
  });

  test("tournament logo, sponsor logos and payment QR", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    const asAdmin = t.withIdentity(ADMIN);
    await expect(asAdmin.mutation(api.tournaments.update, { id: tournamentId, logoUrl: OTHER_CLOUD })).rejects.toThrow(/logo/);
    await expect(
      asAdmin.mutation(api.tournaments.update, { id: tournamentId, sponsors: [{ name: "Acme", logoUrl: OTHER_HOST }] }),
    ).rejects.toThrow(/logo/);
    const settings = { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5 };
    await expect(
      asAdmin.mutation(api.tournaments.update, { id: tournamentId, settings: { ...settings, paymentQrUrl: OTHER_HOST } }),
    ).rejects.toThrow(/QR/);
    await asAdmin.mutation(api.tournaments.update, {
      id: tournamentId,
      logoUrl: OURS("tournaments"),
      sponsors: [{ name: "Acme", logoUrl: OURS("tournaments", "acme.png") }],
      settings: { ...settings, paymentQrUrl: OURS("tournaments", "qr.png") },
    });
    await expect(
      asAdmin.mutation(api.tournaments.create, { name: "New Cup", logoUrl: OTHER_CLOUD, settings }),
    ).rejects.toThrow(/logo/);
  });

  test("player photos: our uploads and Drive images, nothing else", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    const asAdmin = t.withIdentity(ADMIN);
    const fields = { age: 25, role: ["Batter"], battingBowlingHand: "Right-handed" as const };
    const player = { tournamentId, ...fields };
    await expect(asAdmin.mutation(api.players.create, { ...player, name: "Bad Photo", photoUrl: OTHER_HOST })).rejects.toThrow(/photo/);
    const id = await asAdmin.mutation(api.players.create, { ...player, name: "Drive Photo", photoUrl: "https://lh3.googleusercontent.com/d/x=w400" });
    await expect(asAdmin.mutation(api.players.update, { id, photoUrl: OTHER_CLOUD })).rejects.toThrow(/photo/);
    const res = await asAdmin.mutation(api.players.bulkImport, {
      tournamentId,
      players: [{ ...fields, name: "Imported", photoUrl: OTHER_HOST }],
    });
    expect(res).toMatchObject({ success: false, errors: [{ row: 0, field: "photoUrl" }] });
  });

  test("registration photo, payment screenshot and file answers", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    const entry = {
      tournamentId,
      name: "Registrant",
      age: 22,
      role: ["Batter"],
      battingBowlingHand: "Right-handed" as const,
      phoneNumber: "9876543210",
      consentWhatsApp: false,
      website: "",
    };
    await expect(t.mutation(api.registrations.submit, { ...entry, photoUrl: OTHER_CLOUD })).rejects.toThrow(/photo/i);
    const res = await t.mutation(api.registrations.submit, { ...entry, photoUrl: OURS("registrations") });
    expect(res.success).toBe(true);
  });
});
