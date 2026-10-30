// convex/notifications.ts
// Outbound player notifications (WhatsApp via the Meta Cloud API).
//
// WhatsApp platform rule: a business-initiated message to someone who has NOT
// messaged us in the last 24h MUST use a pre-approved template. We therefore
// send a "template" message with numbered body parameters rather than free-form
// text. See the setup steps in WHATSAPP_NOTIFICATIONS.md.
//
// Outbox (AUDIT 2026-10 P1-14): finalizePlayerSale only inserts a row
// (enqueueSoldNotification) in its own transaction, so a messaging problem
// can never touch the sale. processQueue sends at most BATCH_SIZE a second,
// retries with backoff up to MAX_ATTEMPTS, and reclaims rows a crashed run
// left in "sending". Phone numbers are masked in logs.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireAdmin } from "./auth";
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

type SoldPayload = Doc<"notifications">["payload"];

/** "+91•••••3210": enough to tell numbers apart in logs, no more. */
function maskPhone(e164: string): string {
  return `+${e164.slice(0, 2)}•••••${e164.slice(-4)}`;
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
  const dedupeKey = `sold:${player._id}:${team._id}`;
  const existing = await ctx.db
    .query("notifications")
    .withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey))
    .first();
  if (existing) return null;

  const now = Date.now();
  const id = await ctx.db.insert("notifications", {
    kind: "player_sold",
    dedupeKey,
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
    status: "queued",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.processQueue, {});
  return id;
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
    const claimed = [...due, ...stuck].slice(0, BATCH_SIZE);
    await Promise.all(
      claimed.map((n) => ctx.db.patch(n._id, { status: "sending", claimedAt: now, attempts: n.attempts + 1 })),
    );
    return claimed.map((n) => ({ _id: n._id, payload: n.payload }));
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

/** Send one template message. Never throws. */
async function sendSoldTemplate(
  payload: SoldPayload,
): Promise<{ outcome: "sent" | "skipped" | "error"; detail?: string }> {
  if (process.env.WHATSAPP_NOTIFICATIONS_ENABLED === "false") {
    return { outcome: "skipped", detail: "notifications_disabled" };
  }
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return { outcome: "skipped", detail: "not_configured" };
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME ?? "player_sold";
  const templateLang = process.env.WHATSAPP_TEMPLATE_LANG ?? "en";
  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";
  const e164 = normalizePhone(payload.phoneNumber, process.env.WHATSAPP_DEFAULT_COUNTRY_CODE ?? "91");
  if (!e164) return { outcome: "skipped", detail: "invalid_phone" };

  // Ordered body parameters — must match {{1}}..{{6}} in the approved template.
  const bodyParams = [
    payload.playerName,
    payload.tournamentName,
    payload.teamName,
    payload.ownerName,
    payload.captainName?.trim() || "—",
    formatRupees(payload.soldPrice),
  ].map((text) => ({ type: "text" as const, text }));

  try {
    const res = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: e164,
        type: "template",
        template: { name: templateName, language: { code: templateLang }, components: [{ type: "body", parameters: bodyParams }] },
      }),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      console.error(`[whatsapp] Meta error ${res.status} for ${maskPhone(e164)}: ${text}`);
      return { outcome: "error", detail: `meta_${res.status}: ${text}` };
    }
    const data = (await res.json()) as { messages?: Array<{ id?: string }> };
    return { outcome: "sent", detail: data.messages?.[0]?.id };
  } catch (err) {
    console.error(`[whatsapp] Network error for ${maskPhone(e164)}:`, err);
    return { outcome: "error", detail: `network_error: ${String(err).slice(0, 200)}` };
  }
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
    const claimed: Array<{ _id: Id<"notifications">; payload: SoldPayload }> =
      await ctx.runMutation(internal.notifications.claimDue, {});
    for (const row of claimed) {
      const result = await sendSoldTemplate(row.payload);
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

/** Outbox depth and failures for the live-ops panel. Super-admin only. */
export const queueStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
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
  },
});
