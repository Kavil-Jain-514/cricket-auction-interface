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

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { logAdminAction, OWNER_ONLY, requireAdmin, requireTournamentRole } from "./auth";
import { formatRupees } from "./bidRules";

/**
 * Normalize a raw phone number into E.164 digits (no leading "+").
 * - Strips spaces, dashes, parentheses, and a leading "+" or "00".
 * - If the result is a bare local number (<= 10 digits and no country code),
 *   prepends WHATSAPP_DEFAULT_COUNTRY_CODE (default "91" for India).
 * Returns null if there aren't enough digits to be a real number.
 */
export function normalizePhone(
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
const BATCH_SIZE = 10; // per second: far below Meta's per-number throughput
const RETRY_BASE_MS = 30_000; // 30s, 60s, 2m, 4m
const STUCK_SENDING_MS = 5 * 60_000;

type Kind = Doc<"notifications">["kind"];
type Payload = Doc<"notifications">["payload"];
type SoldPayload = Extract<Payload, { soldPrice: number }>;

const defaultCountryCode = () => process.env.WHATSAPP_DEFAULT_COUNTRY_CODE ?? "91";

/** "+91•••••3210": enough to tell numbers apart in logs, no more. */
function maskPhone(e164: string): string {
  return `+${e164.slice(0, 2)}•••••${e164.slice(-4)}`;
}

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
  await ctx.scheduler.runAfter(0, internal.notifications.processQueue, {});
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

/** Claim up to BATCH_SIZE due rows (and any stuck in "sending"). */
export const claimDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
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
      const e164 = normalizePhone(n.payload.phoneNumber, defaultCountryCode());
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

/** Earliest retry still queued, or null when the outbox is drained. */
export const nextDueAt = internalQuery({
  args: {},
  handler: async (ctx) => {
    const next = await ctx.db
      .query("notifications")
      .withIndex("by_status_next", (q) => q.eq("status", "queued"))
      .first();
    return next?.nextAttemptAt ?? null;
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
  const e164 = normalizePhone(payload.phoneNumber, defaultCountryCode());
  if (!e164) return { outcome: "skipped", detail: "invalid_phone" };
  return await provider.send(e164, templateFor(kind, payload));
}

/**
 * Drain the outbox: one batch per run, then reschedule itself for the next
 * batch (1s later) or the earliest retry. Runs for every enqueue, so several
 * may overlap; claimDue hands each row to exactly one of them.
 */
export const processQueue = internalAction({
  args: {},
  // Explicit types: this action calls back into its own module through
  // `internal`, which would otherwise make the generated API types circular.
  handler: async (ctx): Promise<{ processed: number }> => {
    const claimed: Array<{ _id: Id<"notifications">; kind: Kind; payload: Payload }> =
      await ctx.runMutation(internal.notifications.claimDue, {});
    for (const row of claimed) {
      const result = await sendOne(row.kind, row.payload);
      await ctx.runMutation(internal.notifications.recordResult, { id: row._id, ...result });
    }
    if (claimed.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(1000, internal.notifications.processQueue, {});
    } else {
      const next: number | null = await ctx.runQuery(internal.notifications.nextDueAt, {});
      if (next !== null) {
        await ctx.scheduler.runAfter(Math.max(0, next - Date.now()), internal.notifications.processQueue, {});
      }
    }
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
    await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);
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
    if (!row) throw new Error("Message not found");
    const owner = await requireTournamentRole(ctx, row.tournamentId, OWNER_ONLY);
    if (row.status !== "failed") throw new Error("Only failed messages can be resent");
    await ctx.db.patch(row._id, { status: "queued", attempts: 0, nextAttemptAt: Date.now(), lastError: undefined, claimedAt: undefined });
    await ctx.scheduler.runAfter(0, internal.notifications.processQueue, {});
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
