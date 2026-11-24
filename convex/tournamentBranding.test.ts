/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// tournaments:getBranding feeds the broadcast overlay (no sign-in) and the
// player/team PDFs. Fixtures follow auctions.test.ts.
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const LOGO = "https://res.cloudinary.com/demo/image/upload/logo.png";
const ORG = "https://res.cloudinary.com/demo/image/upload/org.png";
const SPONSOR = "https://res.cloudinary.com/demo/image/upload/sponsor.png";

async function seed(t: ReturnType<typeof convexTest>, extra: Record<string, unknown> = {}) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { email: "owner@test.com", createdAt: now });
    return await ctx.db.insert("tournaments", {
      name: "Open Cup",
      createdBy: ownerId,
      status: "active",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5, paymentQrUrl: "https://res.cloudinary.com/demo/image/upload/qr.png" },
      logoUrl: LOGO,
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
  });
}

describe("tournaments:getBranding", () => {
  test("returns the logos and sponsors to a signed-out viewer, and nothing else", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, {
      organizationLogoUrl: ORG,
      sponsors: [{ name: "Acme", logoUrl: SPONSOR }, { name: "No Logo Co" }],
    });
    expect(await t.query(api.tournaments.getBranding, { tournamentId: id })).toEqual({
      name: "Open Cup",
      logoUrl: LOGO,
      organizationLogoUrl: ORG,
      sponsors: [{ name: "Acme", logoUrl: SPONSOR }, { name: "No Logo Co" }],
    });
  });

  test("an empty sponsor list when none are set", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    const branding = await t.query(api.tournaments.getBranding, { tournamentId: id });
    expect(branding?.sponsors).toEqual([]);
    expect(branding?.organizationLogoUrl).toBeUndefined();
  });

  test("null for a deactivated tournament", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, { isActive: false });
    expect(await t.query(api.tournaments.getBranding, { tournamentId: id })).toBeNull();
  });
});
