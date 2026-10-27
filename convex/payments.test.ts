/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { upgradePrice } from "./planTiers";

// Step 16c: Razorpay orders and the signed webhook. Fixtures follow
// auctions.test.ts (see there for why _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ORG = { email: "org@test.com", subject: "org|1" };
const OTHER = { email: "other@test.com", subject: "other|1" };
const SECRET = "whsec_test";

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function setup(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { email: ORG.email, createdAt: Date.now() });
    await ctx.db.insert("users", { email: OTHER.email, createdAt: Date.now() });
  });
  const tournamentId = await t.withIdentity(ORG).mutation(api.tournaments.create, {
    name: "Pay Cup",
    settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5 },
  });
  return { tournamentId };
}

function paidEvent(orderId: string, paymentId: string, amount: number, tournamentId: string, tier = "club") {
  return JSON.stringify({
    event: "order.paid",
    payload: {
      payment: { entity: { id: paymentId, amount, order_id: orderId, status: "captured" } },
      order: { entity: { id: orderId, amount, amount_paid: amount, status: "paid", notes: { tournamentId, tier } } },
    },
  });
}

async function postWebhook(t: ReturnType<typeof convexTest>, body: string, signature?: string) {
  return await t.fetch("/razorpay/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Razorpay-Signature": signature ?? (await hmacHex(SECRET, body)) },
    body,
  });
}

beforeEach(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});

describe("upgradePrice", () => {
  test("charges the difference between tiers, in paise", () => {
    expect(upgradePrice("free", "club")).toBe(99_900);
    expect(upgradePrice("club", "league")).toBe(200_000);
    expect(upgradePrice("league", "league")).toBeNull();
    expect(upgradePrice("pro", "club")).toBeNull();
  });
});

describe("payments.recordOrder", () => {
  test("owner records an upgrade order at the right amount", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.withIdentity(ORG).mutation(api.payments.recordOrder, { tournamentId, tier: "club", razorpayOrderId: "order_1", amount: 99_900 });
    const orders = await t.run((ctx) => ctx.db.query("paymentOrders").collect());
    expect(orders).toMatchObject([{ tier: "club", amount: 99_900, status: "created" }]);
  });

  test("rejects a wrong amount, a non-upgrade, a duplicate order id and other organisers", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const asOrg = t.withIdentity(ORG);
    await expect(asOrg.mutation(api.payments.recordOrder, { tournamentId, tier: "club", razorpayOrderId: "o", amount: 1 })).rejects.toThrow(/amount/);
    await expect(asOrg.mutation(api.payments.recordOrder, { tournamentId, tier: "free", razorpayOrderId: "o", amount: 0 })).rejects.toThrow(/upgrade/);
    await asOrg.mutation(api.payments.recordOrder, { tournamentId, tier: "club", razorpayOrderId: "dup", amount: 99_900 });
    await expect(asOrg.mutation(api.payments.recordOrder, { tournamentId, tier: "club", razorpayOrderId: "dup", amount: 99_900 })).rejects.toThrow(/already/);
    await expect(
      t.withIdentity(OTHER).mutation(api.payments.recordOrder, { tournamentId, tier: "club", razorpayOrderId: "x", amount: 99_900 }),
    ).rejects.toThrow(/access to this tournament/);
  });
});

describe("Razorpay webhook", () => {
  test("a signed order.paid upgrades the plan", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.withIdentity(ORG).mutation(api.payments.recordOrder, { tournamentId, tier: "club", razorpayOrderId: "order_1", amount: 99_900 });

    const res = await postWebhook(t, paidEvent("order_1", "pay_1", 99_900, tournamentId));
    expect(res.status).toBe(200);
    const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(tournament?.plan).toMatchObject({ tier: "club", maxTeams: 8, maxPlayers: 150, paymentRef: "pay_1" });
  });

  test("rejects a bad signature and changes nothing", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.withIdentity(ORG).mutation(api.payments.recordOrder, { tournamentId, tier: "club", razorpayOrderId: "order_1", amount: 99_900 });

    const body = paidEvent("order_1", "pay_1", 99_900, tournamentId);
    expect((await postWebhook(t, body, "deadbeef")).status).toBe(401);
    expect((await postWebhook(t, body, await hmacHex("wrong-secret", body))).status).toBe(401);
    expect((await t.run((ctx) => ctx.db.get(tournamentId)))?.plan?.tier).toBe("free");
  });

  test("a replayed webhook is a no-op", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.withIdentity(ORG).mutation(api.payments.recordOrder, { tournamentId, tier: "club", razorpayOrderId: "order_1", amount: 99_900 });
    const body = paidEvent("order_1", "pay_1", 99_900, tournamentId);

    expect((await postWebhook(t, body)).status).toBe(200);
    const after1 = await t.run((ctx) => ctx.db.get(tournamentId));
    expect((await postWebhook(t, body)).status).toBe(200);
    const after2 = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(after2?.plan).toEqual(after1?.plan);
    const logs = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(logs.filter((l) => l.action === "plan_payment")).toHaveLength(1);
  });

  test("an amount or tournament mismatch is ignored, not applied", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.withIdentity(ORG).mutation(api.payments.recordOrder, { tournamentId, tier: "club", razorpayOrderId: "order_1", amount: 99_900 });

    expect((await postWebhook(t, paidEvent("order_1", "pay_1", 100, tournamentId))).status).toBe(200);
    expect((await postWebhook(t, paidEvent("order_1", "pay_2", 99_900, "someOtherTournament"))).status).toBe(200);
    expect((await postWebhook(t, paidEvent("order_unknown", "pay_3", 99_900, tournamentId))).status).toBe(200);
    expect((await t.run((ctx) => ctx.db.get(tournamentId)))?.plan?.tier).toBe("free");
  });

  test("other events are acknowledged and ignored", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const body = JSON.stringify({ event: "payment.failed", payload: {} });
    expect((await postWebhook(t, body)).status).toBe(200);
  });

  test("without a webhook secret configured, nothing is trusted", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const body = paidEvent("order_1", "pay_1", 99_900, tournamentId);
    expect((await postWebhook(t, body, await hmacHex(SECRET, body))).status).toBe(500);
  });
});
