/// <reference types="vite/client" />
// The WhatsApp outbox's single worker (convex/notifications.ts): submit only
// writes its own rows; one leased worker drains the queue at a fixed pace.
//
// convex-test runs one transaction at a time, so these tests prove the
// bookkeeping (who writes what, at-most-once sending, lease takeover), not
// production OCC behaviour under true concurrency. That is what
// scripts/loadtest/registrations.mjs CONSENT=1 checks on the dev deployment.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { NOTIFY_BATCH_INTERVAL_MS, NOTIFY_BATCH_SIZE } from "./notifications";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const OWNER = { email: "owner@test.com", subject: "owner|1" };

async function setup(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { email: OWNER.email, createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Open Cup",
      createdBy: ownerId,
      status: "setup",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5, registrationOpen: true },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: ownerId, role: "owner", createdAt: now });
    return { tournamentId };
  });
}

const entry = (i: number, consentWhatsApp = true) => ({
  name: `Player ${i}`,
  age: 24,
  role: ["Bowler"],
  battingBowlingHand: "Right-handed" as const,
  phoneNumber: `98765${String(i).padStart(5, "0")}`,
  consentWhatsApp,
  website: "",
});

/** Queued outbox rows straight into the table, as submits would leave them. */
async function queueRows(t: ReturnType<typeof convexTest>, tournamentId: Id<"tournaments">, n: number) {
  await t.run(async (ctx) => {
    for (let i = 0; i < n; i++) {
      await ctx.db.insert("notifications", {
        kind: "registration_received",
        dedupeKey: `registered:test-${i}`,
        tournamentId,
        payload: { playerName: `Player ${i}`, phoneNumber: `98765${String(i).padStart(5, "0")}`, tournamentName: "Open Cup" },
        status: "queued",
        attempts: 0,
        nextAttemptAt: Date.now(),
        createdAt: Date.now(),
      });
    }
  });
}

const rows = (t: ReturnType<typeof convexTest>, table: "notifications" | "workerLeases" | "registrations" | "rateLimits") =>
  t.run((ctx) => ctx.db.query(table).collect());

/** Meta mock that records who was messaged and when. */
function mockMeta() {
  const calls: Array<{ to: string; at: number }> = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push({ to: JSON.parse(init.body as string).to, at: Date.now() });
    return Response.json({ messages: [{ id: `wamid.${calls.length}` }] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-19T10:00:05Z") });
  Object.assign(process.env, { WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_ACCESS_TOKEN: "token" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
});

describe("WhatsApp outbox worker", () => {
  test("300 simultaneous submits with consent: submit writes only its own rows; one paced worker sends each message once", async () => {
    const calls = mockMeta();
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const tournamentBefore = await t.run((ctx) => ctx.db.get(tournamentId));

    await Promise.all(Array.from({ length: 300 }, (_, i) => t.mutation(api.registrations.submit, { tournamentId, ...entry(i) })));

    // Before any scheduled function runs: each submit wrote its registration,
    // its own queue row and (sharded) rate-limit counters, nothing shared.
    expect(await rows(t, "registrations")).toHaveLength(300);
    const queued = await rows(t, "notifications");
    expect(queued).toHaveLength(300);
    expect(queued.every((n) => n.status === "queued")).toBe(true);
    expect(await rows(t, "workerLeases")).toHaveLength(0);
    expect((await rows(t, "rateLimits")).length).toBeLessThanOrEqual(64);
    expect(await t.run((ctx) => ctx.db.get(tournamentId))).toEqual(tournamentBefore);
    expect(calls).toHaveLength(0);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(300);
    expect(new Set(calls.map((c) => c.to)).size).toBe(300);
    const sent = await rows(t, "notifications");
    expect(sent.every((n) => n.status === "sent" && n.attempts === 1)).toBe(true);
    expect(await rows(t, "workerLeases")).toHaveLength(0);

    // One worker: never more than a batch at one moment, batches spaced out.
    const perInstant = new Map<number, number>();
    for (const c of calls) perInstant.set(c.at, (perInstant.get(c.at) ?? 0) + 1);
    expect(Math.max(...perInstant.values())).toBeLessThanOrEqual(NOTIFY_BATCH_SIZE);
    const instants = [...perInstant.keys()].sort((a, b) => a - b);
    for (let i = 1; i < instants.length; i++) expect(instants[i] - instants[i - 1]).toBeGreaterThanOrEqual(NOTIFY_BATCH_INTERVAL_MS);
  });

  test("overlapping worker runs, a stray run id and the old argument-less call never send a message twice", async () => {
    const calls = mockMeta();
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await queueRows(t, tournamentId, 25);
    await t.run((ctx) => ctx.db.insert("workerLeases", { name: "whatsapp", runId: "A", leaseUntil: Date.now() + 10 * 60_000 }));

    await Promise.all([
      t.action(internal.notifications.processQueue, { runId: "A" }),
      t.action(internal.notifications.processQueue, { runId: "A" }),
      t.action(internal.notifications.processQueue, { runId: "B" }),
      t.action(internal.notifications.processQueue, {}),
    ]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(25);
    expect(new Set(calls.map((c) => c.to)).size).toBe(25);
    expect((await rows(t, "notifications")).every((n) => n.status === "sent")).toBe(true);
  });

  test("an expired lease never blocks sending", async () => {
    const calls = mockMeta();
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.run((ctx) => ctx.db.insert("workerLeases", { name: "whatsapp", runId: "dead", leaseUntil: Date.now() - 1 }));
    await t.mutation(api.registrations.submit, { tournamentId, ...entry(1) });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toHaveLength(1);
  });

  test("a worker that died holding a live lease is taken over by the sweep once the lease runs out", async () => {
    const calls = mockMeta();
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.run((ctx) => ctx.db.insert("workerLeases", { name: "whatsapp", runId: "dead", leaseUntil: Date.now() + 60_000 }));
    await t.mutation(api.registrations.submit, { tournamentId, ...entry(1) });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toHaveLength(0);
    expect((await rows(t, "notifications"))[0].status).toBe("queued");

    vi.setSystemTime(Date.now() + 61_000);
    await t.action(internal.notifications.processQueue, {}); // what the 5-minute sweep runs
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toHaveLength(1);
    expect((await rows(t, "notifications"))[0].status).toBe("sent");
  });

  test("consent off: no queue row, no lease, nothing sent", async () => {
    const calls = mockMeta();
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.mutation(api.registrations.submit, { tournamentId, ...entry(1, false) });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await rows(t, "notifications")).toHaveLength(0);
    expect(await rows(t, "workerLeases")).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  test("a message enqueued while the worker is finishing is still sent by that run, not left for the sweep", async () => {
    const calls = mockMeta();
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.run((ctx) => ctx.db.insert("workerLeases", { name: "whatsapp", runId: "A", leaseUntil: Date.now() + 60_000 }));
    await queueRows(t, tournamentId, 1);
    // The worker's "nothing left?" check runs after the row landed: it must carry on.
    expect(await t.mutation(internal.notifications.finishRun, { runId: "A" })).toEqual({ done: false });
    await t.action(internal.notifications.processQueue, { runId: "A" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toHaveLength(1);
    expect(await rows(t, "workerLeases")).toHaveLength(0);
  });
});
