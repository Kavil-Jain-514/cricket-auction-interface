// convex/ops.ts - Super-admin live-ops panel (AUDIT 2026-10 Phase 5).
// Presence comes from consoles and owner paddles only (a 30 s heartbeat);
// viewers never write, so the viewer count stays an estimate from the Convex
// dashboard and the load test (decision D2).
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { getCurrentUser, getTournamentRole, requireAdmin } from "./auth";
import { findOwnerMembership } from "./members";
import { runsAuction } from "./policy";
import { notificationStats } from "./notifications";
import { consumeRateLimit } from "./rateLimit";

/** A heartbeat older than this means the client is gone. */
export const PRESENCE_WINDOW_MS = 75_000;
const ERROR_REPORTS = { limit: 30, windowMs: 60_000 };
const MAX_MESSAGE = 300;

/** The caller's role in the room's tournament: console, owner, or neither. */
async function roomRole(ctx: MutationCtx, room: Doc<"auctionRooms">, user: Doc<"users">) {
  if (runsAuction(await getTournamentRole(ctx, room.tournamentId, user))) return "console" as const;
  if (await findOwnerMembership(ctx, user._id, room.tournamentId)) return "owner" as const;
  return null;
}

/** "This console / paddle is open." Called every 30 s; no-op for anyone else. */
export const heartbeat = mutation({
  args: { auctionRoomId: v.id("auctionRooms") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const room = await ctx.db.get(args.auctionRoomId);
    if (!user || !room) return null;
    const role = await roomRole(ctx, room, user);
    if (!role) return null;
    const row = await ctx.db
      .query("presence")
      .withIndex("by_user_room", (q) => q.eq("userId", user._id).eq("auctionRoomId", room._id))
      .first();
    const lastSeen = Date.now();
    if (row) await ctx.db.patch(row._id, { lastSeen, role });
    else await ctx.db.insert("presence", { userId: user._id, auctionRoomId: room._id, tournamentId: room.tournamentId, role, lastSeen });
    return null;
  },
});

/** A console or paddle hit an exception. Rate-limited; ignored from anyone else. */
export const reportClientError = mutation({
  args: { auctionRoomId: v.id("auctionRooms"), fn: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const room = await ctx.db.get(args.auctionRoomId);
    if (!user || !room || !(await roomRole(ctx, room, user))) return null;
    if (!(await consumeRateLimit(ctx, `client-error:${user._id}`, ERROR_REPORTS))) return null;
    await ctx.db.insert("clientErrors", {
      userId: user._id,
      auctionRoomId: room._id,
      fn: args.fn.slice(0, 80),
      message: args.message.slice(0, MAX_MESSAGE),
      at: Date.now(),
    });
    return null;
  },
});

/** Per-user hourly limits for the Next.js routes that cost us bandwidth or storage. */
const ROUTE_QUOTAS = {
  upload: { limit: 60, windowMs: 60 * 60 * 1000 },
  imageProxy: { limit: 300, windowMs: 60 * 60 * 1000 },
} as const;

/**
 * Called by /api/upload and /api/image-proxy with the caller's token, before
 * any work: counts one request against the caller's hourly quota for that
 * route. False when over, or when not signed in (AUDIT 2026-11 SEC-009).
 */
export const consumeRouteQuota = mutation({
  args: { route: v.union(v.literal("upload"), v.literal("imageProxy")) },
  handler: async (ctx, args): Promise<boolean> => {
    const user = await getCurrentUser(ctx);
    if (!user) return false;
    return await consumeRateLimit(ctx, `route:${args.route}:${user._id}`, ROUTE_QUOTAS[args.route]);
  },
});

/** Called by the Razorpay webhook route (convex/http.ts) for every request. */
export const recordWebhook = internalMutation({
  args: { event: v.string(), orderId: v.optional(v.string()), outcome: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("webhookEvents", { ...args, receivedAt: Date.now() });
  },
});

/** Daily cron: keep 30 days of webhooks and client errors, a day of presence and of expired upload grants. */
export const purgeOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const month = now - 30 * 24 * 60 * 60 * 1000;
    const [webhooks, errors, presence, grants] = await Promise.all([
      ctx.db.query("webhookEvents").withIndex("by_receivedAt", (q) => q.lt("receivedAt", month)).take(500),
      ctx.db.query("clientErrors").withIndex("by_at", (q) => q.lt("at", month)).take(500),
      ctx.db.query("presence").withIndex("by_lastSeen", (q) => q.lt("lastSeen", now - 24 * 60 * 60 * 1000)).take(500),
      // Registrant upload grants a day past expiry (used or not).
      ctx.db.query("uploadGrants").withIndex("by_expiresAt", (q) => q.lt("expiresAt", now - 24 * 60 * 60 * 1000)).take(500),
    ]);
    await Promise.all([...webhooks, ...errors, ...presence, ...grants].map((doc) => ctx.db.delete(doc._id)));
  },
});

// ── Retention (AUDIT 2026-11 PERF-009) ───────────────────────────────────────
const RESOLVED_RAISE_DAYS = 30;
const OUTBOX_DAYS = 90;
const PURGE_BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily cron: owner raises resolved more than 30 days ago. Only pending
 * raises affect bidding; the auditLogs rows of accepted/rejected raises
 * stay, so nothing an auditor needs is lost.
 */
export const purgeOldBidRequests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RESOLVED_RAISE_DAYS * DAY_MS;
    const old = (
      await Promise.all(
        (["accepted", "rejected", "superseded"] as const).map((status) =>
          ctx.db
            .query("bidRequests")
            .withIndex("by_status_createdAt", (q) => q.eq("status", status).lt("createdAt", cutoff))
            .take(PURGE_BATCH),
        ),
      )
    ).flat();
    await Promise.all(old.map((row) => ctx.db.delete(row._id)));
    return { deleted: old.length };
  },
});

/**
 * Daily cron: WhatsApp and email outbox rows finished more than 90 days ago.
 * They hold phone numbers and email addresses, which aren't needed once a
 * message is long settled. Queued and in-flight rows are never touched.
 */
export const purgeOldOutboxRows = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - OUTBOX_DAYS * DAY_MS;
    const [notifications, emails] = await Promise.all([
      Promise.all(
        (["sent", "delivered", "failed", "skipped"] as const).map((status) =>
          ctx.db
            .query("notifications")
            .withIndex("by_status_next", (q) => q.eq("status", status).lt("nextAttemptAt", cutoff))
            .take(PURGE_BATCH),
        ),
      ),
      Promise.all(
        (["sent", "failed", "skipped"] as const).map((status) =>
          ctx.db
            .query("emails")
            .withIndex("by_status_next", (q) => q.eq("status", status).lt("nextAttemptAt", cutoff))
            .take(PURGE_BATCH),
        ),
      ),
    ]);
    const rows = [...notifications.flat(), ...emails.flat()];
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
    return { deleted: rows.length };
  },
});

/** Everything the live-ops panel shows. Super-admin only. */
export const liveOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const [live, paused] = await Promise.all([
      ctx.db.query("auctionRooms").withIndex("by_status", (q) => q.eq("status", "live")).collect(),
      ctx.db.query("auctionRooms").withIndex("by_status", (q) => q.eq("status", "paused")).collect(),
    ]);
    const rooms = await Promise.all(
      [...live, ...paused].map(async (room) => {
        const [tournament, player, presence] = await Promise.all([
          ctx.db.get(room.tournamentId),
          room.currentPlayerId ? ctx.db.get(room.currentPlayerId) : null,
          ctx.db
            .query("presence")
            .withIndex("by_room", (q) => q.eq("auctionRoomId", room._id).gt("lastSeen", now - PRESENCE_WINDOW_MS))
            .collect(),
        ]);
        const online = await Promise.all(
          presence.map(async (p) => ({
            email: (await ctx.db.get(p.userId))?.email ?? "(deleted user)",
            role: p.role,
            secondsAgo: Math.round((now - p.lastSeen) / 1000),
          })),
        );
        return {
          _id: room._id,
          tournamentName: tournament?.name ?? "(deleted)",
          status: room.status,
          rehearsal: room.rehearsal ?? false,
          currentPlayer: player?.name ?? null,
          lastActivity: room.updatedAt,
          online,
        };
      }),
    );

    const errors = await ctx.db.query("clientErrors").withIndex("by_at").order("desc").take(20);
    const recentErrors = await Promise.all(
      errors.map(async (e) => ({
        _id: e._id,
        at: e.at,
        fn: e.fn,
        message: e.message,
        email: (await ctx.db.get(e.userId))?.email ?? "(deleted user)",
      })),
    );
    const webhooks = await ctx.db.query("webhookEvents").withIndex("by_receivedAt").order("desc").take(10);

    // Refunds due: small tables on this path (only failed-to-apply payments).
    const [planRefunds, registrationRefunds] = await Promise.all([
      ctx.db.query("paymentOrders").withIndex("by_refundDue", (q) => q.eq("refundDue", true)).take(100),
      ctx.db.query("registrationOrders").withIndex("by_refundDue", (q) => q.eq("refundDue", true)).take(100),
    ]);

    return {
      rooms,
      recentErrors,
      webhooks: webhooks.map((w) => ({ _id: w._id, event: w.event, orderId: w.orderId, outcome: w.outcome, receivedAt: w.receivedAt })),
      whatsapp: await notificationStats(ctx),
      refundsDue: { plans: planRefunds.length, registrations: registrationRefunds.length },
    };
  },
});
