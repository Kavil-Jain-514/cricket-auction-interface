// convex/notifications.ts
// Outbound player notifications on WhatsApp: "you're registered", "you're
// approved" and "you were sold".
//
// WhatsApp platform rule: a business-initiated message to someone who has NOT
// messaged us in the last 24h MUST use a pre-approved template. We therefore
// send "template" messages with numbered body parameters rather than
// free-form text. Template texts and setup: WHATSAPP_NOTIFICATIONS.md.
//
// Outbox (AUDIT 2026-10 P1-14): the sale or registration only inserts a row
// in its own transaction, so a messaging problem can never touch it.
// processQueue sends at most BATCH_SIZE a second through a
// NotificationProvider (Meta Cloud API, or a log-only one for development),
// retries with backoff up to MAX_ATTEMPTS, and reclaims rows a crashed run
// left in "sending". One row per event and person (dedupeKey), so nothing is
// ever sent twice. The signed webhook in http.ts marks rows delivered and
// records STOP/START replies (whatsappOptOuts). Phone numbers are masked in logs.

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { logAdminAction, OWNER_ONLY, requireAdmin, REVIEW_REGISTRATIONS, requireTournamentRole } from "./auth";
import { formatRupees } from "./bidRules";

/**
 * A raw phone number as E.164 digits (no leading "+"), for WhatsApp. Not
 * validation.normalizePhone, which keeps an Indian number's 10 digits.
 * - Strips spaces, dashes, parentheses, and a leading "+" or "00".
 * - If the result is a bare local number (<= 10 digits and no country code),
 *   prepends WHATSAPP_DEFAULT_COUNTRY_CODE (default "91" for India).
 * Returns null if there aren't enough digits to be a real number.
 */
export function toE164(
  raw: string,
  defaultCountryCode: string,
): string | null {
  let s = raw.trim();
  if (s.startsWith("00")) s = s.slice(2);
  const hadPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7) return null; // too short to be valid

  // Already includes a country code (had a "+" or is longer than a local number).
  if (hadPlus || digits.length > 10) return digits;

  // Bare local number — prepend the default country code.
  return `${defaultCountryCode.replace(/\D/g, "")}${digits}`;
}

export { formatRupees };

const MAX_ATTEMPTS = 5;
/** Messages per batch, and the gap between batches: 10 a second, far below Meta's per-number throughput. */
export const NOTIFY_BATCH_SIZE = 10;
export const NOTIFY_BATCH_INTERVAL_MS = 1000;
const BATCH_SIZE = NOTIFY_BATCH_SIZE;
const RETRY_BASE_MS = 30_000; // 30s, 60s, 2m, 4m
const STUCK_SENDING_MS = 5 * 60_000;
const SEND_TIMEOUT_MS = 15_000;
/** How long after an enqueue the worker starts, so a burst of registrations is sent as one paced run. */
export const NOTIFY_KICK_DELAY_MS = 3000;
/**
 * How long a run's lease lasts without renewal. Renewed every batch; a batch
 * can take BATCH_SIZE sends at SEND_TIMEOUT_MS each, so the lease outlives the
 * slowest batch. A crashed run blocks the worker for at most this long.
 */
const LEASE_MS = BATCH_SIZE * SEND_TIMEOUT_MS + 60_000;
const LEASE_NAME = "whatsapp";

type Kind = Doc<"notifications">["kind"];
type Payload = Doc<"notifications">["payload"];
type SoldPayload = Extract<Payload, { soldPrice: number }>;

const defaultCountryCode = () => process.env.WHATSAPP_DEFAULT_COUNTRY_CODE ?? "91";

/** "+91•••••3210": enough to tell numbers apart in logs, no more. */
function maskPhone(e164: string): string {
  return `+${e164.slice(0, 2)}•••••${e164.slice(-4)}`;
}

/*
 * One worker at a time (2026-11-20; the registration load test). Before, every
 * enqueue scheduled its own processQueue, so a rush of 300 registrations
 * started 300 workers that all claimed the head of the same queue (OCC
 * conflicts, runs failing until the 5-minute sweep) and, by rescheduling
 * themselves, kept several chains sending in parallel, past the pace above.
 *
 * Now a run must hold the "whatsapp" lease (workerLeases). The lease row is
 * shared, so the transaction that enqueues never touches it: enqueue (inside
 * submit, a sale, an approval) only inserts its own outbox row and schedules
 * `kick`, which inserts a new scheduler entry and conflicts with nothing. The
 * kick, a separate transaction a few seconds later, starts a run only if no
 * run holds the lease; the kicks of a burst find it held and end without
 * writing. The run sends a batch, renews the lease, and schedules its next
 * batch NOTIFY_BATCH_INTERVAL_MS later; finishRun releases the lease in the
 * same transaction that finds nothing due, so a row enqueued meanwhile is
 * either seen by that check or kicks a new run after the release. A crashed
 * run's lease expires after LEASE_MS; the 5-minute sweep (crons.ts) then
 * takes over. claimDue still hands each row to one run only, so overlapping
 * runs (an expired lease, an old argument-less call) never send twice.
 */

/** Take the worker lease if nobody holds it (or theirs expired); the new run id, or null. */
async function acquireLease(ctx: MutationCtx): Promise<string | null> {
  const now = Date.now();
  const lease = await ctx.db
    .query("workerLeases")
    .withIndex("by_name", (q) => q.eq("name", LEASE_NAME))
    .first();
  if (lease && lease.leaseUntil > now) return null;
  const runId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  if (lease) await ctx.db.patch(lease._id, { runId, leaseUntil: now + LEASE_MS });
  else await ctx.db.insert("workerLeases", { name: LEASE_NAME, runId, leaseUntil: now + LEASE_MS });
  return runId;
}

async function leaseFor(ctx: MutationCtx, runId: string) {
  const lease = await ctx.db
    .query("workerLeases")
    .withIndex("by_name", (q) => q.eq("name", LEASE_NAME))
    .first();
  return lease && lease.runId === runId ? lease : null;
}

/** Start a run unless one holds the lease. Scheduled by enqueue; never by the enqueuing transaction itself. */
export const kick = internalMutation({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const runId = await acquireLease(ctx);
    if (runId) await ctx.scheduler.runAfter(0, internal.notifications.processQueue, { runId });
    return runId !== null;
  },
});

/** For an argument-less run (the sweep cron, or calls queued before this change). */
export const tryAcquire = internalMutation({
  args: {},
  handler: (ctx): Promise<string | null> => acquireLease(ctx),
});

/**
 * End of a run with a short batch: release the lease if nothing is due, and
 * wake a later run for the earliest retry. Anything due keeps the run going.
 */
export const finishRun = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, args): Promise<{ done: boolean }> => {
    const lease = await leaseFor(ctx, args.runId);
    if (!lease) return { done: true }; // lost the lease: another run carries on
    const now = Date.now();
    const next = await ctx.db
      .query("notifications")
      .withIndex("by_status_next", (q) => q.eq("status", "queued"))
      .first();
    if (next && next.nextAttemptAt <= now) return { done: false };
    await ctx.db.delete(lease._id);
    if (next) await ctx.scheduler.runAt(next.nextAttemptAt, internal.notifications.kick, {});
    return { done: true };
  },
});

/** Insert one outbox row unless this event was already queued, and wake the worker. */
async function enqueue(
  ctx: MutationCtx,
  row: Pick<Doc<"notifications">, "kind" | "dedupeKey" | "tournamentId" | "payload"> &
    Partial<Pick<Doc<"notifications">, "playerId" | "registrationId">>,
): Promise<Id<"notifications"> | null> {
  const existing = await ctx.db
    .query("notifications")
    .withIndex("by_dedupe", (q) => q.eq("dedupeKey", row.dedupeKey))
    .first();
  if (existing) return null;
  const now = Date.now();
  const id = await ctx.db.insert("notifications", { ...row, status: "queued", attempts: 0, nextAttemptAt: now, createdAt: now });
  // Only a new scheduler entry: no shared row is read or written here.
  await ctx.scheduler.runAfter(NOTIFY_KICK_DELAY_MS, internal.notifications.kick, {});
  return id;
}

/**
 * Queue the "player sold" message. Called inside finalizePlayerSale; only
 * writes a row and schedules the worker. No-ops for no phone, a player who
 * declined on the registration form, or a message already queued for this
 * player and team.
 */
export async function enqueueSoldNotification(
  ctx: MutationCtx,
  args: {
    player: Doc<"players">;
    team: Doc<"teams">;
    tournament: Doc<"tournaments">;
    soldPrice: number;
  },
): Promise<Id<"notifications"> | null> {
  const { player, team, tournament } = args;
  if (!player.phoneNumber?.trim() || player.consentWhatsApp === false) return null;
  return await enqueue(ctx, {
    kind: "player_sold",
    dedupeKey: `sold:${player._id}:${team._id}`,
    tournamentId: tournament._id,
    playerId: player._id,
    payload: {
      playerName: player.name,
      phoneNumber: player.phoneNumber,
      tournamentName: tournament.name,
      teamName: team.name,
      ownerName: team.ownerName,
      captainName: team.captainName,
      soldPrice: args.soldPrice,
    },
  });
}

/**
 * Queue "registration received" (on submit) or "registration approved" (on
 * approval). Only for registrants who ticked the WhatsApp box; once per
 * registration and event.
 */
export async function enqueueRegistrationNotification(
  ctx: MutationCtx,
  kind: "registration_received" | "registration_approved",
  args: { registration: Doc<"registrations">; tournament: Doc<"tournaments">; playerId?: Id<"players"> },
): Promise<Id<"notifications"> | null> {
  const { registration, tournament } = args;
  if (!registration.consentWhatsApp || !registration.phoneNumber) return null;
  return await enqueue(ctx, {
    kind,
    dedupeKey: `${kind === "registration_received" ? "registered" : "approved"}:${registration._id}`,
    tournamentId: tournament._id,
    registrationId: registration._id,
    playerId: args.playerId,
    payload: { playerName: registration.name, phoneNumber: registration.phoneNumber, tournamentName: tournament.name },
  });
}

/**
 * Claim up to BATCH_SIZE due rows (and any stuck in "sending") for the run
 * holding the lease, renewing it. Null when the run no longer holds it.
 */
export const claimDue = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const lease = await leaseFor(ctx, args.runId);
    if (!lease) return null;
    const now = Date.now();
    await ctx.db.patch(lease._id, { leaseUntil: now + LEASE_MS });
    const due = await ctx.db
      .query("notifications")
      .withIndex("by_status_next", (q) => q.eq("status", "queued").lte("nextAttemptAt", now))
      .take(BATCH_SIZE);
    const stuck = (
      await ctx.db
        .query("notifications")
        .withIndex("by_status_next", (q) => q.eq("status", "sending"))
        .take(BATCH_SIZE)
    ).filter((n) => (n.claimedAt ?? 0) < now - STUCK_SENDING_MS);
    const claimed: Array<{ _id: Id<"notifications">; kind: Kind; payload: Payload }> = [];
    for (const n of [...due, ...stuck].slice(0, BATCH_SIZE)) {
      // Replied STOP: never messaged, not even a retry.
      const e164 = toE164(n.payload.phoneNumber, defaultCountryCode());
      const optedOut = e164 && (await ctx.db.query("whatsappOptOuts").withIndex("by_phone", (q) => q.eq("phone", e164)).first());
      if (optedOut) {
        await ctx.db.patch(n._id, { status: "skipped", lastError: "opted_out" });
        continue;
      }
      await ctx.db.patch(n._id, { status: "sending", claimedAt: now, attempts: n.attempts + 1 });
      claimed.push({ _id: n._id, kind: n.kind, payload: n.payload });
    }
    return claimed;
  },
});

/** Store one send's outcome: sent, skipped, retry later, or failed for good. */
export const recordResult = internalMutation({
  args: {
    id: v.id("notifications"),
    outcome: v.union(v.literal("sent"), v.literal("skipped"), v.literal("error")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    const now = Date.now();
    if (args.outcome === "sent") {
      await ctx.db.patch(row._id, { status: "sent", sentAt: now, messageId: args.detail, lastError: undefined });
    } else if (args.outcome === "skipped") {
      await ctx.db.patch(row._id, { status: "skipped", lastError: args.detail });
    } else if (row.attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(row._id, { status: "failed", lastError: args.detail });
    } else {
      await ctx.db.patch(row._id, {
        status: "queued",
        lastError: args.detail,
        nextAttemptAt: now + RETRY_BASE_MS * 2 ** (row.attempts - 1),
      });
    }
  },
});

type SendResult = { outcome: "sent" | "skipped" | "error"; detail?: string };

/**
 * Where messages go. The Meta Cloud API in production; a log-only provider
 * (WHATSAPP_PROVIDER=log) for local development, which sends nothing.
 */
export interface NotificationProvider {
  send(to: string, template: { name: string; params: string[] }): Promise<SendResult>;
}

const metaCloudProvider = (phoneNumberId: string, accessToken: string): NotificationProvider => ({
  async send(to, template) {
    const graphVersion = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";
    const language = process.env.WHATSAPP_TEMPLATE_LANG ?? "en";
    try {
      const res = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: template.name,
            language: { code: language },
            components: [{ type: "body", parameters: template.params.map((text) => ({ type: "text", text })) }],
          },
        }),
        // A hung request would hold the row in "sending" until the 5-minute
        // reclaim; give up and retry instead (AUDIT 2026-11 REL-002).
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        console.error(`[whatsapp] Meta error ${res.status} for ${maskPhone(to)}: ${text}`);
        return { outcome: "error", detail: `meta_${res.status}: ${text}` };
      }
      const data = (await res.json()) as { messages?: Array<{ id?: string }> };
      return { outcome: "sent", detail: data.messages?.[0]?.id };
    } catch (err) {
      console.error(`[whatsapp] Network error for ${maskPhone(to)}:`, err);
      return { outcome: "error", detail: `network_error: ${String(err).slice(0, 200)}` };
    }
  },
});

const logProvider: NotificationProvider = {
  async send(to, template) {
    console.log(`[whatsapp:log] ${template.name} to ${maskPhone(to)}: ${template.params.join(" | ")}`);
    return { outcome: "sent", detail: `log-${Date.now()}` };
  },
};

/** The configured provider, or why nothing can be sent. */
function providerFromEnv(): NotificationProvider | { skip: string } {
  if (process.env.WHATSAPP_NOTIFICATIONS_ENABLED === "false") return { skip: "notifications_disabled" };
  if (process.env.WHATSAPP_PROVIDER === "log") return logProvider;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return { skip: "not_configured" };
  return metaCloudProvider(phoneNumberId, accessToken);
}

/**
 * The approved template for each message and its ordered body parameters,
 * which must match {{1}}, {{2}}, … in WHATSAPP_NOTIFICATIONS.md.
 */
export function templateFor(kind: Kind, payload: Payload): { name: string; params: string[] } {
  if (kind === "player_sold") {
    const p = payload as SoldPayload;
    return {
      name: process.env.WHATSAPP_TEMPLATE_NAME ?? "player_sold",
      params: [p.playerName, p.tournamentName, p.teamName, p.ownerName, p.captainName?.trim() || "—", formatRupees(p.soldPrice)],
    };
  }
  const name =
    kind === "registration_received"
      ? (process.env.WHATSAPP_TEMPLATE_REGISTERED ?? "registration_received")
      : (process.env.WHATSAPP_TEMPLATE_APPROVED ?? "registration_approved");
  return { name, params: [payload.playerName, payload.tournamentName] };
}

/** Send one outbox row. Never throws. */
async function sendOne(kind: Kind, payload: Payload): Promise<SendResult> {
  const provider = providerFromEnv();
  if ("skip" in provider) return { outcome: "skipped", detail: provider.skip };
  const e164 = toE164(payload.phoneNumber, defaultCountryCode());
  if (!e164) return { outcome: "skipped", detail: "invalid_phone" };
  return await provider.send(e164, templateFor(kind, payload));
}

/**
 * One batch of the outbox for the run holding the lease (see the comment
 * above acquireLease), then the next batch NOTIFY_BATCH_INTERVAL_MS later.
 * Without a runId (the sweep cron, or a call queued before the lease
 * existed) it takes the lease if free and works as a new run, else does
 * nothing.
 */
export const processQueue = internalAction({
  args: { runId: v.optional(v.string()) },
  // Explicit types: this action calls back into its own module through
  // `internal`, which would otherwise make the generated API types circular.
  handler: async (ctx, args): Promise<{ processed: number }> => {
    const runId: string | null = args.runId ?? (await ctx.runMutation(internal.notifications.tryAcquire, {}));
    if (!runId) return { processed: 0 };
    const claimed: Array<{ _id: Id<"notifications">; kind: Kind; payload: Payload }> | null =
      await ctx.runMutation(internal.notifications.claimDue, { runId });
    if (!claimed) return { processed: 0 }; // another run holds the lease
    for (const row of claimed) {
      const result = await sendOne(row.kind, row.payload);
      await ctx.runMutation(internal.notifications.recordResult, { id: row._id, ...result });
    }
    const more: boolean =
      claimed.length === BATCH_SIZE || !(await ctx.runMutation(internal.notifications.finishRun, { runId })).done;
    if (more) await ctx.scheduler.runAfter(NOTIFY_BATCH_INTERVAL_MS, internal.notifications.processQueue, { runId });
    return { processed: claimed.length };
  },
});

/**
 * Delivery receipts from the webhook. "delivered" and "read" mark the row
 * delivered; a late "failed" (Meta accepted, then couldn't deliver) marks it
 * failed so the organiser can resend. Never moves a row backwards.
 */
export const applyStatuses = internalMutation({
  args: { statuses: v.array(v.object({ id: v.string(), status: v.string(), error: v.optional(v.string()) })) },
  handler: async (ctx, args) => {
    for (const s of args.statuses) {
      const row = await ctx.db
        .query("notifications")
        .withIndex("by_messageId", (q) => q.eq("messageId", s.id))
        .first();
      if (!row) continue;
      if ((s.status === "delivered" || s.status === "read") && row.status === "sent") {
        await ctx.db.patch(row._id, { status: "delivered", deliveredAt: Date.now() });
      } else if (s.status === "failed" && (row.status === "sent" || row.status === "delivered")) {
        await ctx.db.patch(row._id, { status: "failed", lastError: `meta_status: ${s.error ?? "failed"}`.slice(0, 300) });
      }
    }
  },
});

/** A STOP (opt out) or START (opt back in) reply from a number we message. */
export const setOptOut = internalMutation({
  args: { phone: v.string(), optedOut: v.boolean() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("whatsappOptOuts")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();
    if (args.optedOut && !existing) await ctx.db.insert("whatsappOptOuts", { phone: args.phone, at: Date.now() });
    if (!args.optedOut && existing) await ctx.db.delete(existing._id);
  },
});

/**
 * Message status per registration and player, for the organiser's
 * registrations page. Owners only; no phone numbers.
 */
export const listForTournament = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireTournamentRole(ctx, args.tournamentId, REVIEW_REGISTRATIONS);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      kind: r.kind,
      registrationId: r.registrationId,
      playerId: r.playerId,
      status: r.status,
      lastError: r.lastError,
      createdAt: r.createdAt,
    }));
  },
});

/**
 * Send a failed message again. Owners only. Re-queues the same row, so a
 * double click (or a resend racing the first one) can't send twice.
 */
export const resend = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.notificationId);
    if (!row) throw new ConvexError("Message not found");
    const owner = await requireTournamentRole(ctx, row.tournamentId, OWNER_ONLY);
    if (row.status !== "failed") throw new ConvexError("Only failed messages can be resent");
    await ctx.db.patch(row._id, { status: "queued", attempts: 0, nextAttemptAt: Date.now(), lastError: undefined, claimedAt: undefined });
    await ctx.scheduler.runAfter(0, internal.notifications.kick, {});
    await logAdminAction(ctx, {
      userId: owner._id,
      userEmail: owner.email,
      action: "resend_whatsapp",
      targetType: "notification",
      targetId: row._id,
      previousData: { status: row.status, lastError: row.lastError },
      newData: { kind: row.kind },
      tournamentId: row.tournamentId,
    });
    return { success: true };
  },
});

/** Outbox depth and the last failure (shared with ops:liveOverview). */
export async function notificationStats(ctx: QueryCtx) {
  const count = async (status: Doc<"notifications">["status"]) =>
    (
      await ctx.db
        .query("notifications")
        .withIndex("by_status_next", (q) => q.eq("status", status))
        .take(1000)
    ).length;
  const [queued, sending, failed] = await Promise.all([count("queued"), count("sending"), count("failed")]);
  const lastFailure = await ctx.db
    .query("notifications")
    .withIndex("by_status_next", (q) => q.eq("status", "failed"))
    .order("desc")
    .first();
  return { queued, sending, failed, lastError: lastFailure?.lastError ?? null };
}

/** Outbox depth and failures for the live-ops panel. Super-admin only. */
export const queueStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await notificationStats(ctx);
  },
});
