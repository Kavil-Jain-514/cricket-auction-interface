// convex/registrations.ts - Public player registration (/register/<id>).
// Anyone can submit while the organiser has registration open; an optional
// fee is paid through Razorpay (the signed webhook in http.ts marks it paid);
// the organiser approves, which creates the player through the same
// validation as players:create. Registrants can never set auction fields.
import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { consumeRateLimit } from "./rateLimit";
import { logAdminAction, OWNER_ONLY, requireTournamentRole } from "./auth";
import { syncTournamentAuctionCounts } from "./auctionCounts";
import { insertValidatedPlayer } from "./players";
import { normalizePhone, validatePlayerFields } from "./validation";
import { cloudinarySignature } from "./cloudinarySignature";

const MAX_PER_PHONE_PER_DAY = 3;
// Per tournament, whatever the phone: a spammer rotating numbers is capped,
// a real registration rush (a link shared in a group) stays under it.
const SUBMIT_LIMIT = { limit: 30, windowMs: 60 * 1000 };
const UPLOAD_SIGNATURE_LIMIT = { limit: 60, windowMs: 60 * 1000 };
const DAY_MS = 24 * 60 * 60 * 1000;
const PHOTO_FOLDER = "cricket-auction/registrations";
const PHOTO_FORMATS = "jpg,jpeg,png,webp";

const tshirtSize = v.optional(
  v.union(v.literal("XS"), v.literal("S"), v.literal("M"), v.literal("L"), v.literal("XL"), v.literal("XXL"), v.literal("3XL"), v.literal("4XL")),
);

const duplicateKey = (name: string, phone: string | undefined) => `${name.trim().toLowerCase()}|${phone ?? ""}`;

/** Normalised phone of a stored player, tolerating legacy formats. */
function playerPhone(p: Doc<"players">): string | undefined {
  const phone = normalizePhone(p.phoneNumber);
  return phone.ok ? phone.phone : p.phoneNumber;
}

/** Name, logo, fee and whether the form is open. Public; nothing private. */
export const getPublicInfo = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament || tournament.isActive === false) return null;
    return {
      name: tournament.name,
      logoUrl: tournament.logoUrl,
      open: tournament.settings.registrationOpen === true && tournament.status !== "completed",
      fee: tournament.settings.registrationFee ?? 0,
    };
  },
});

/**
 * Signed parameters for a direct browser upload of the registrant's photo to
 * Cloudinary (image formats only; the client also caps the size). Public, but
 * only while the tournament's registration is open.
 */
export const getUploadSignature = action({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const info = await ctx.runQuery(api.registrations.getPublicInfo, { tournamentId: args.tournamentId });
    if (!info?.open) throw new Error("Registration is closed");
    const allowed = await ctx.runMutation(internal.rateLimit.consume, {
      key: `upload:${args.tournamentId}`,
      ...UPLOAD_SIGNATURE_LIMIT,
    });
    if (!allowed) throw new Error("Too many uploads right now. Try again in a minute.");
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) throw new Error("Photo upload isn't set up; you can register without a photo");
    const params = { allowed_formats: PHOTO_FORMATS, folder: PHOTO_FOLDER, timestamp: Math.floor(Date.now() / 1000) };
    return { cloudName, apiKey, ...params, signature: await cloudinarySignature(params, apiSecret) };
  },
});

/**
 * Public, anonymous registration. Only player profile fields are accepted
 * (no auctionStatus, basePrice or category). `website` is a honeypot: humans
 * never see it, so anything in it means a bot, which gets a fake success.
 */
export const submit = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.string(),
    age: v.number(),
    role: v.array(v.string()),
    battingBowlingHand: v.union(v.literal("Right-handed"), v.literal("Left-handed")),
    phoneNumber: v.string(),
    photoUrl: v.optional(v.string()),
    jerseyNumber: v.optional(v.number()),
    jerseyName: v.optional(v.string()),
    tshirtSize,
    consentWhatsApp: v.boolean(),
    website: v.string(),
  },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament || tournament.isActive === false) throw new Error("Tournament not found");
    if (!tournament.settings.registrationOpen || tournament.status === "completed") {
      throw new Error("Registration is closed for this tournament");
    }
    if (args.website.trim() !== "") return { success: true as const, needsPayment: false, fee: 0 };
    if (!(await consumeRateLimit(ctx, `register:${args.tournamentId}`, SUBMIT_LIMIT))) {
      throw new Error("Too many registrations right now. Try again in a minute.");
    }

    const { website: _honeypot, consentWhatsApp, tournamentId, ...fields } = args;
    const { errors, phoneNumber } = validatePlayerFields(fields, tournament.settings.basePurse);
    if (errors.length > 0) throw new Error(errors[0].message);
    if (!phoneNumber) throw new Error("Phone number is required");
    if (fields.role.length === 0) throw new Error("Choose at least one role");
    if (fields.photoUrl && !fields.photoUrl.startsWith("https://res.cloudinary.com/")) {
      throw new Error("Upload your photo with the form's photo button");
    }

    const now = Date.now();
    const samePhone = await ctx.db
      .query("registrations")
      .withIndex("by_tournament_phone", (q) => q.eq("tournamentId", tournamentId).eq("phoneNumber", phoneNumber))
      .collect();
    if (samePhone.filter((r) => r.createdAt > now - DAY_MS).length >= MAX_PER_PHONE_PER_DAY) {
      throw new Error("Too many registrations from this phone number today. Try again tomorrow.");
    }

    // Indexed on the normalised phone: no full roster scan on a public path.
    // (Approval re-checks against every player, legacy phone formats too.)
    const key = duplicateKey(fields.name, phoneNumber);
    const playersWithPhone = await ctx.db
      .query("players")
      .withIndex("by_tournament_phone", (q) => q.eq("tournamentId", tournamentId).eq("phoneNumber", phoneNumber))
      .collect();
    if (
      samePhone.some((r) => r.status !== "rejected" && duplicateKey(r.name, r.phoneNumber) === key) ||
      playersWithPhone.some((p) => duplicateKey(p.name, playerPhone(p)) === key)
    ) {
      throw new Error(`${fields.name.trim()} is already registered for this tournament`);
    }

    const fee = Math.max(0, tournament.settings.registrationFee ?? 0);
    const registrationId = await ctx.db.insert("registrations", {
      ...fields,
      name: fields.name.trim(),
      tournamentId,
      phoneNumber,
      consentWhatsApp,
      status: fee > 0 ? "pending_payment" : "paid",
      fee,
      createdAt: now,
    });
    return { success: true as const, registrationId, needsPayment: fee > 0, fee };
  },
});

/** Checkouts a registrant may open; more than this is abuse, not a retry. */
const MAX_ORDERS_PER_REGISTRATION = 10;

/**
 * Record a Razorpay order the registrant is paying (called by
 * app/api/registrations/order). Public: the registrant has no account. Safe
 * because only the signed webhook can mark it paid, and only at this amount.
 * Every order is kept (AUDIT 2026-10 P1-8): opening checkout twice and paying
 * the first must still find the registration.
 */
export const recordOrder = mutation({
  args: { registrationId: v.id("registrations"), razorpayOrderId: v.string(), amount: v.number() },
  handler: async (ctx, args) => {
    const registration = await ctx.db.get(args.registrationId);
    if (!registration) throw new Error("Registration not found");
    if (registration.status !== "pending_payment") throw new Error("Nothing to pay for this registration");
    if (args.amount !== registration.fee * 100) throw new Error(`Wrong amount: expected ${registration.fee * 100} paise`);
    const existing = await ctx.db
      .query("registrationOrders")
      .withIndex("by_order", (q) => q.eq("razorpayOrderId", args.razorpayOrderId))
      .first();
    if (existing) throw new Error("That order is already recorded");
    const orders = (
      await ctx.db
        .query("registrationOrders")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", registration.tournamentId))
        .collect()
    ).filter((o) => o.registrationId === registration._id);
    if (orders.length >= MAX_ORDERS_PER_REGISTRATION) {
      throw new Error("Too many payment attempts for this registration. Contact the organiser.");
    }
    await ctx.db.insert("registrationOrders", {
      registrationId: registration._id,
      tournamentId: registration.tournamentId,
      razorpayOrderId: args.razorpayOrderId,
      amount: args.amount,
      status: "created",
      createdAt: Date.now(),
    });
    // Latest order on the registration too, for older webhook lookups.
    await ctx.db.patch(args.registrationId, { razorpayOrderId: args.razorpayOrderId });
    return { success: true };
  },
});

/**
 * Verified Razorpay order.paid for a registration fee. Idempotent per order.
 * A payment the registration can no longer take (already paid through
 * another checkout, or rejected) is recorded as refund due, never dropped.
 */
export const applyRegistrationPayment = internalMutation({
  args: { razorpayOrderId: v.string(), paymentId: v.string(), amount: v.number(), notesRegistrationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query("registrationOrders")
      .withIndex("by_order", (q) => q.eq("razorpayOrderId", args.razorpayOrderId))
      .first();
    // Orders recorded before registrationOrders existed live on the registration.
    const registration = order
      ? await ctx.db.get(order.registrationId)
      : await ctx.db
          .query("registrations")
          .withIndex("by_order", (q) => q.eq("razorpayOrderId", args.razorpayOrderId))
          .first();
    if (!registration) return { applied: false, reason: "unknown order" };
    if (args.notesRegistrationId !== undefined && args.notesRegistrationId !== registration._id) {
      return { applied: false, reason: "registration mismatch" };
    }
    if (args.amount !== registration.fee * 100) return { applied: false, reason: "amount mismatch" };
    if (order?.status === "paid" || registration.paymentRef === args.paymentId) {
      return { applied: false, reason: "already paid" };
    }

    const now = Date.now();
    if (registration.status !== "pending_payment") {
      if (order) {
        await ctx.db.patch(order._id, { status: "paid", paymentRef: args.paymentId, paidAt: now, refundDue: true });
      }
      return { applied: false, reason: `registration is ${registration.status}; refund due` };
    }
    await ctx.db.patch(registration._id, { status: "paid", paymentRef: args.paymentId });
    if (order) await ctx.db.patch(order._id, { status: "paid", paymentRef: args.paymentId, paidAt: now });
    return { applied: true };
  },
});

/** Fee payments that could not be applied and must be refunded. Owners only. */
export const listRefundsDue = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);
    const due = (
      await ctx.db
        .query("registrationOrders")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect()
    ).filter((o) => o.refundDue);
    return await Promise.all(
      due.map(async (o) => ({
        _id: o._id,
        registrationId: o.registrationId,
        name: (await ctx.db.get(o.registrationId))?.name ?? "(deleted registration)",
        razorpayOrderId: o.razorpayOrderId,
        paymentRef: o.paymentRef,
        amount: o.amount,
        paidAt: o.paidAt,
      })),
    );
  },
});

/** Owner review list, newest first, with duplicates flagged. Includes phones. */
export const list = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);
    const [rows, players] = await Promise.all([
      ctx.db
        .query("registrations")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .order("desc")
        .collect(),
      ctx.db
        .query("players")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect(),
    ]);
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (r.status === "rejected") continue;
      const key = duplicateKey(r.name, r.phoneNumber);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const playerKeys = new Set(players.filter((p) => !rows.some((r) => r.playerId === p._id)).map((p) => duplicateKey(p.name, playerPhone(p))));
    return rows.map((r) => {
      const key = duplicateKey(r.name, r.phoneNumber);
      return { ...r, duplicate: r.status !== "approved" && r.status !== "rejected" && ((counts.get(key) ?? 0) > 1 || playerKeys.has(key)) };
    });
  },
});

async function approveOne(ctx: MutationCtx, registration: Doc<"registrations">, admin: Doc<"users">): Promise<Id<"players">> {
  if (registration.status !== "paid") {
    throw new Error(registration.status === "pending_payment" ? "Not paid yet" : `Already ${registration.status}`);
  }
  const tournament = await ctx.db.get(registration.tournamentId);
  if (!tournament) throw new Error("Tournament not found");

  const players = await ctx.db
    .query("players")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", registration.tournamentId))
    .collect();
  if (players.some((p) => duplicateKey(p.name, playerPhone(p)) === duplicateKey(registration.name, registration.phoneNumber))) {
    throw new Error(`${registration.name} is already a player`);
  }

  // Same validation, category and plan-limit rules as players:create.
  const playerId = await insertValidatedPlayer(ctx, tournament, {
    name: registration.name,
    age: registration.age,
    role: registration.role,
    battingBowlingHand: registration.battingBowlingHand,
    phoneNumber: registration.phoneNumber,
    photoUrl: registration.photoUrl,
    jerseyNumber: registration.jerseyNumber,
    jerseyName: registration.jerseyName,
    tshirtSize: registration.tshirtSize,
    consentWhatsApp: registration.consentWhatsApp,
  });
  await ctx.db.patch(registration._id, { status: "approved", playerId, reviewedAt: Date.now() });
  await logAdminAction(ctx, {
    userId: admin._id,
    userEmail: admin.email,
    action: "approve_registration",
    targetType: "player",
    targetId: playerId,
    newData: { name: registration.name, registrationId: registration._id },
    tournamentId: registration.tournamentId,
  });
  return playerId;
}

/** Approve one registration: creates the player. Owners only. */
export const approve = mutation({
  args: { registrationId: v.id("registrations") },
  handler: async (ctx, args) => {
    const registration = await ctx.db.get(args.registrationId);
    if (!registration) throw new Error("Registration not found");
    const admin = await requireTournamentRole(ctx, registration.tournamentId, OWNER_ONLY);
    const playerId = await approveOne(ctx, registration, admin);
    await syncTournamentAuctionCounts(ctx, registration.tournamentId);
    return playerId;
  },
});

/** Approve every registration that is ready (paid). Failures are reported, not fatal. */
export const bulkApprove = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const admin = await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);
    const ready = (
      await ctx.db
        .query("registrations")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect()
    )
      .filter((r) => r.status === "paid")
      .sort((a, b) => a.createdAt - b.createdAt);
    let approved = 0;
    const failed: Array<{ registrationId: Id<"registrations">; name: string; reason: string }> = [];
    for (const registration of ready) {
      try {
        await approveOne(ctx, registration, admin);
        approved++;
      } catch (error) {
        failed.push({ registrationId: registration._id, name: registration.name, reason: (error as Error).message });
      }
    }
    if (approved > 0) await syncTournamentAuctionCounts(ctx, args.tournamentId);
    return { approved, failed };
  },
});

/** Reject with a reason (kept on the registration and in the audit log). */
export const reject = mutation({
  args: { registrationId: v.id("registrations"), reason: v.string() },
  handler: async (ctx, args) => {
    const registration = await ctx.db.get(args.registrationId);
    if (!registration) throw new Error("Registration not found");
    const admin = await requireTournamentRole(ctx, registration.tournamentId, OWNER_ONLY);
    const reason = args.reason.trim();
    if (!reason) throw new Error("A reason is required");
    if (registration.status === "approved") throw new Error("Already approved; delete the player instead");
    await ctx.db.patch(args.registrationId, { status: "rejected", rejectReason: reason.slice(0, 200), reviewedAt: Date.now() });
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "reject_registration",
      targetType: "registration",
      targetId: args.registrationId,
      newData: { name: registration.name, reason },
      tournamentId: registration.tournamentId,
    });
    return { success: true };
  },
});

/** Fee and status for the payment step of the public form. No PII. */
export const getPaymentInfo = query({
  args: { registrationId: v.id("registrations") },
  handler: async (ctx, args) => {
    const registration = await ctx.db.get(args.registrationId);
    if (!registration) return null;
    const tournament = await ctx.db.get(registration.tournamentId);
    const orders = (
      await ctx.db
        .query("registrationOrders")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", registration.tournamentId))
        .collect()
    ).filter((o) => o.registrationId === registration._id);
    return {
      status: registration.status,
      fee: registration.fee,
      ordersLeft: Math.max(0, MAX_ORDERS_PER_REGISTRATION - orders.length),
      tournamentId: registration.tournamentId,
      tournamentName: tournament?.name ?? "Tournament",
    };
  },
});
