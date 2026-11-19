/// <reference types="vite/client" />
// Users are identified by their sign-in (tokenIdentifier: issuer + subject),
// not by the email claim (AUDIT 2026-11 SEC-006). A row from before this is
// found by email once and linked to the sign-in that claims it; after that, a
// different sign-in with the same email never gets that row or its roles.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ORIGINAL = { email: "admin@test.com", subject: "user_original" };
const NEWCOMER = { email: "admin@test.com", subject: "user_newcomer" }; // same email, another account
const token = (subject: string) => `https://convex.test|${subject}`;

async function legacyAdmin(t: ReturnType<typeof convexTest>) {
  return await t.run((ctx) => ctx.db.insert("users", { email: ORIGINAL.email, role: "admin", createdAt: Date.now() }));
}

describe("users are identified by sign-in, not email", () => {
  test("a legacy row is linked to the first sign-in that claims it", async () => {
    const t = convexTest(schema, modules);
    const userId = await legacyAdmin(t);
    expect(await t.withIdentity(ORIGINAL).mutation(api.auth.ensureUser, {})).toBe(userId);
    expect((await t.run((ctx) => ctx.db.get(userId)))?.tokenIdentifier).toBe(token(ORIGINAL.subject));
    expect(await t.withIdentity(ORIGINAL).query(api.auth.me, {})).toMatchObject({ _id: userId, isAdmin: true });
  });

  test("another sign-in with the same email doesn't inherit the row or its admin role", async () => {
    const t = convexTest(schema, modules);
    await legacyAdmin(t);
    await t.withIdentity(ORIGINAL).mutation(api.auth.ensureUser, {});

    const asNewcomer = t.withIdentity(NEWCOMER);
    expect(await asNewcomer.query(api.auth.me, {})).toBeNull();
    await expect(asNewcomer.mutation(api.auth.ensureUser, {})).rejects.toThrow(/already linked to another sign-in/);
    await expect(asNewcomer.mutation(api.plans.grantPlan, { tournamentId: "x" as never, tier: "pro", reason: "r" })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  });

  test("a changed email at the identity provider follows the sign-in", async () => {
    const t = convexTest(schema, modules);
    const userId = await legacyAdmin(t);
    await t.withIdentity(ORIGINAL).mutation(api.auth.ensureUser, {});
    const renamed = { ...ORIGINAL, email: "new-address@test.com" };

    expect(await t.withIdentity(renamed).query(api.auth.me, {})).toMatchObject({ _id: userId, isAdmin: true });
    await t.withIdentity(renamed).mutation(api.auth.ensureUser, {});
    expect((await t.run((ctx) => ctx.db.get(userId)))?.email).toBe("new-address@test.com");
  });

  test("new users are created with their sign-in", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.withIdentity(NEWCOMER).mutation(api.auth.ensureUser, {});
    expect(await t.run((ctx) => ctx.db.get(userId))).toMatchObject({ email: NEWCOMER.email, tokenIdentifier: token(NEWCOMER.subject) });
  });

  test("support can unlink a row so the person's new sign-in can claim it", async () => {
    const t = convexTest(schema, modules);
    const userId = await legacyAdmin(t);
    await t.withIdentity(ORIGINAL).mutation(api.auth.ensureUser, {});

    await t.mutation(internal.auth.unlinkSignIn, { email: ORIGINAL.email });
    expect(await t.withIdentity(NEWCOMER).mutation(api.auth.ensureUser, {})).toBe(userId);
    expect(await t.withIdentity(ORIGINAL).query(api.auth.me, {})).toBeNull();
  });
});
