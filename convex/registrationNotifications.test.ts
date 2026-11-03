/// <reference types="vite/client" />
// Phase 10: WhatsApp on registration and on approval, through the same
// outbox as "player sold": never blocks the request, never sends twice,
// consent and opt-outs respected, delivery tracked by a signed webhook.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const OWNER = { email: "owner@test.com", subject: "owner|1" };
const AUCTIONEER = { email: "auctioneer@test.com", subject: "auctioneer|1" };
const APP_SECRET = "meta_app_secret";

async function setup(t: ReturnType<typeof convexTest>, settings: Record<string, unknown> = {}) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", { email: OWNER.email, createdAt: now });
    const auctioneer = await ctx.db.insert("users", { email: AUCTIONEER.email, createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Msg Cup",
      createdBy: owner,
      status: "setup",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5, registrationOpen: true, ...settings },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: owner, role: "owner", createdAt: now });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: auctioneer, role: "auctioneer", createdAt: now });
    return { tournamentId };
  });
}

const entry = (tournamentId: string, over: Record<string, unknown> = {}) => ({
  tournamentId: tournamentId as never,
  name: "Ravi Kumar",
  age: 24,
  role: ["Bowler"],
  battingBowlingHand: "Right-handed" as const,
  phoneNumber: "98765 43210",
  consentWhatsApp: true,
  website: "",
  ...over,
});

const outbox = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("notifications").collect());

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function webhook(t: ReturnType<typeof convexTest>, payload: unknown, secret = APP_SECRET) {
  const body = JSON.stringify(payload);
  return await t.fetch("/whatsapp/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${await hmacHex(secret, body)}` },
    body,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.WHATSAPP_PHONE_NUMBER_ID = "pn";
  process.env.WHATSAPP_ACCESS_TOKEN = "tok";
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "verify-me";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const key of ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_PROVIDER", "WHATSAPP_NOTIFICATIONS_ENABLED"]) {
    delete process.env[key];
  }
});

describe("registration messages", () => {
  test("registering queues one 'received' message and sends the registration template", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const fetchMock = vi.fn(async () => Response.json({ messages: [{ id: "wamid.r1" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await t.mutation(api.registrations.submit, entry(tournamentId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [row] = await outbox(t);
    expect(row).toMatchObject({ kind: "registration_received", status: "sent", messageId: "wamid.r1" });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({
      to: "919876543210",
      template: { name: "registration_received", components: [{ type: "body", parameters: [{ text: "Ravi Kumar" }, { text: "Msg Cup" }] }] },
    });
  });

  test("approving queues one 'approved' message; approving can't send it twice", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ messages: [{ id: "wamid.x" }] })));
    await t.mutation(api.registrations.submit, entry(tournamentId));
    const [registration] = await t.withIdentity(OWNER).query(api.registrations.list, { tournamentId });
    await t.withIdentity(OWNER).mutation(api.registrations.approve, { registrationId: registration._id });
    await expect(t.withIdentity(OWNER).mutation(api.registrations.approve, { registrationId: registration._id })).rejects.toThrow();
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const rows = await outbox(t);
    expect(rows.map((r) => r.kind).sort()).toEqual(["registration_approved", "registration_received"]);
    expect(rows.find((r) => r.kind === "registration_approved")?.playerId).toBeDefined();
  });

  test("no consent, no message; the registration still succeeds", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.mutation(api.registrations.submit, entry(tournamentId, { consentWhatsApp: false }));
    expect(await outbox(t)).toEqual([]);
  });

  test("a WhatsApp outage never fails registration; the message is retried, then marked failed", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const res = await t.mutation(api.registrations.submit, entry(tournamentId));
    expect(res.success).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [row] = await outbox(t);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(5);
    expect(row.lastError).toContain("meta_503");
  });

  test("the organiser sees message status and can resend a failed one; others can't", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await t.mutation(api.registrations.submit, entry(tournamentId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [status] = await t.withIdentity(OWNER).query(api.notifications.listForTournament, { tournamentId });
    expect(status).toMatchObject({ kind: "registration_received", status: "failed" });
    await expect(t.withIdentity(AUCTIONEER).query(api.notifications.listForTournament, { tournamentId })).rejects.toThrow(/access/);
    await expect(t.withIdentity(AUCTIONEER).mutation(api.notifications.resend, { notificationId: status._id })).rejects.toThrow(/access/);

    const fetchMock = vi.fn(async () => Response.json({ messages: [{ id: "wamid.again" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await t.withIdentity(OWNER).mutation(api.notifications.resend, { notificationId: status._id });
    // A second click before it sends doesn't queue another message.
    await expect(t.withIdentity(OWNER).mutation(api.notifications.resend, { notificationId: status._id })).rejects.toThrow(/Only failed/);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await outbox(t))[0]).toMatchObject({ status: "sent", messageId: "wamid.again" });
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(audit.some((a) => a.action === "resend_whatsapp")).toBe(true);
  });

  test("the log provider sends nothing over the network (local development)", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    process.env.WHATSAPP_PROVIDER = "log";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await t.mutation(api.registrations.submit, entry(tournamentId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await outbox(t))[0].status).toBe("sent");
  });
});

describe("WhatsApp webhook", () => {
  test("GET verifies the subscription only with the right token", async () => {
    const t = convexTest(schema, modules);
    const ok = await t.fetch("/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42", { method: "GET" });
    expect([ok.status, await ok.text()]).toEqual([200, "42"]);
    const bad = await t.fetch("/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42", { method: "GET" });
    expect(bad.status).toBe(403);
  });

  test("a bad signature changes nothing", async () => {
    const t = convexTest(schema, modules);
    const res = await webhook(t, { entry: [] }, "wrong-secret");
    expect(res.status).toBe(401);
  });

  test("delivery statuses update the outbox; STOP opts the number out and START back in", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ messages: [{ id: "wamid.d1" }] })));
    await t.mutation(api.registrations.submit, entry(tournamentId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const change = (value: unknown) => ({ entry: [{ changes: [{ field: "messages", value }] }] });
    expect((await webhook(t, change({ statuses: [{ id: "wamid.d1", status: "delivered" }] }))).status).toBe(200);
    expect((await outbox(t))[0].status).toBe("delivered");
    // An older "sent" arriving late never moves it back.
    await webhook(t, change({ statuses: [{ id: "wamid.d1", status: "sent" }] }));
    expect((await outbox(t))[0].status).toBe("delivered");

    await webhook(t, change({ messages: [{ from: "919876543210", type: "text", text: { body: " stop " } }] }));
    const fetchMock = vi.fn(async () => Response.json({ messages: [{ id: "wamid.2" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await t.mutation(api.registrations.submit, entry(tournamentId, { name: "Ravi Two" }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await outbox(t)).find((r) => r.payload.playerName === "Ravi Two")).toMatchObject({ status: "skipped", lastError: "opted_out" });

    await webhook(t, change({ messages: [{ from: "919876543210", type: "text", text: { body: "START" } }] }));
    await t.mutation(api.registrations.submit, entry(tournamentId, { name: "Ravi Three" }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
