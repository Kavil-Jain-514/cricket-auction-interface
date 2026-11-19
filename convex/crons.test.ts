/// <reference types="vite/client" />
// The outbox sweeps (AUDIT 2026-11 REL-001). The WhatsApp and email workers
// run when something is enqueued and then reschedule themselves; if a run
// dies (an exception, a deploy mid-run), rows left queued or "sending" used
// to wait for the next enqueue, which may never come. A cron now runs both
// workers every few minutes. Their claimDue is the lock, so a sweep that
// overlaps a running worker never sends anything twice.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { internal } from "./_generated/api";
import schema from "./schema";
import crons from "./crons";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

describe("outbox sweep crons", () => {
  test("both outbox workers are on a schedule of a few minutes", () => {
    const jobs = Object.values(crons.crons);
    for (const fn of [internal.notifications.processQueue, internal.emails.processEmails]) {
      const job = jobs.find((j) => j.name === getFunctionName(fn));
      expect(job, getFunctionName(fn)).toBeDefined();
      expect(job!.schedule).toMatchObject({ type: "interval", minutes: 5 });
    }
  });
});

describe("a sweep recovers rows no enqueue will wake", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.WHATSAPP_PROVIDER = "log";
    process.env.EMAIL_PROVIDER = "log";
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.WHATSAPP_PROVIDER;
    delete process.env.EMAIL_PROVIDER;
  });

  test("a WhatsApp row stuck in 'sending' and a queued row past its retry time are sent", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "o@test.com", createdAt: now });
      const tournamentId = await ctx.db.insert("tournaments", {
        name: "Cup",
        createdBy: userId,
        status: "active",
        settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 3 },
        createdAt: now,
        updatedAt: now,
      });
      const payload = { playerName: "Virat", phoneNumber: "9876543210", tournamentName: "Cup" };
      const stuck = await ctx.db.insert("notifications", {
        kind: "registration_received", dedupeKey: "registered:a", tournamentId, payload,
        status: "sending", attempts: 1, nextAttemptAt: now - 600_000, claimedAt: now - 600_000, createdAt: now - 600_000,
      });
      const due = await ctx.db.insert("notifications", {
        kind: "registration_received", dedupeKey: "registered:b", tournamentId, payload,
        status: "queued", attempts: 1, nextAttemptAt: now - 1_000, createdAt: now - 60_000,
      });
      return { stuck, due };
    });

    // What the cron does: run the worker with nothing newly enqueued.
    await t.action(internal.notifications.processQueue, {});

    const rows = await t.run(async (ctx) => [await ctx.db.get(ids.stuck), await ctx.db.get(ids.due)]);
    expect(rows.map((r) => r?.status)).toEqual(["sent", "sent"]);
  });
});
