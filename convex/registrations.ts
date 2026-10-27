// convex/registrations.ts - Public player registration (/register/<id>).
// Anyone can submit while the organiser has registration open; an optional
// fee is paid by scanning the organiser's QR and uploading a screenshot, in
// person (the owner marks it paid), or through Razorpay (the signed webhook
// in http.ts marks it paid). The organiser approves, which creates the
// player through the same validation as players:create. Registrants may pick
// a category; they can never set auction fields such as price or status.
import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { logAdminAction, OWNER_ONLY, requireTournamentRole } from "./auth";
import { syncTournamentAuctionCounts } from "./auctionCounts";
import { insertValidatedPlayer } from "./players";
import { normalizePhone, validatePlayerFields } from "./validation";
import { cloudinarySignature } from "./cloudinarySignature";

const MAX_PER_PHONE_PER_DAY = 3;
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

const isUploadedImage = (url: string) => url.startsWith("https://res.cloudinary.com/");

/** Throws unless `categoryId` is absent or one of the tournament's categories. */
function assertKnownCategory(tournament: Doc<"tournaments">, categoryId: string | undefined) {
  if (categoryId !== undefined && !(tournament.settings.categories ?? []).some((c) => c.id === categoryId)) {
    throw new Error("Pick a category from the tournament's list");
  }
}

/**
 * Name, logo, sponsors, fee, payment QR, categories and whether the form is
 * open. Public and identity-free; nothing private.
 */
export const getPublicInfo = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament || tournament.isActive === false) return null;
    return {
      name: tournament.name,
      description: tournament.description,
      logoUrl: tournament.logoUrl,
      open: tournament.settings.registrationOpen === true && tournament.status !== "completed",
      fee: tournament.settings.registrationFee ?? 0,
      paymentQrUrl: tournament.settings.paymentQrUrl,
      sponsors: tournament.sponsors ?? [],
      categories: [...(tournament.settings.categories ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((c) => ({ id: c.id, name: c.name })),
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
    categoryId: v.optional(v.string()),
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

    const { website: _honeypot, consentWhatsApp, tournamentId, categoryId, ...fields } = args;
    const { errors, phoneNumber } = validatePlayerFields(fields, tournament.settings.basePurse);
    if (errors.length > 0) throw new Error(errors[0].message);
    if (!phoneNumber) throw new Error("Phone number is required");
    if (fields.role.length === 0) throw new Error("Choose at least one role");
    if (fields.photoUrl && !isUploadedImage(fields.photoUrl)) {
      throw new Error("Upload your photo with the form's photo button");
    }
    assertKnownCategory(tournament, categoryId);

    const now = Date.now();
    const samePhone = await ctx.db
      .query("registrations")
      .withIndex("by_tournament_phone", (q) => q.eq("tournamentId", tournamentId).eq("phoneNumber", phoneNumber))
      .collect();
    if (samePhone.filter((r) => r.createdAt > now - DAY_MS).length >= MAX_PER_PHONE_PER_DAY) {
      throw new Error("Too many registrations from this phone number today. Try again tomorrow.");
    }

    const key = duplicateKey(fields.name, phoneNumber);
    const players = await ctx.db
      .query("players")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
      .collect();
    if (
      samePhone.some((r) => r.status !== "rejected" && duplicateKey(r.name, r.phoneNumber) === key) ||
      players.some((p) => duplicateKey(p.name, playerPhone(p)) === key)
    ) {
      throw new Error(`${fields.name.trim()} is already registered for this tournament`);
    }

    const fee = Math.max(0, tournament.settings.registrationFee ?? 0);
    const registrationId = await ctx.db.insert("registrations", {
      ...fields,
      name: fields.name.trim(),
      tournamentId,
      phoneNumber,
      categoryId,
      consentWhatsApp,
      status: fee > 0 ? "pending_payment" : "paid",
      fee,
      createdAt: now,
    });
    return { success: true as const, registrationId, needsPayment: fee > 0, fee };
  },
});

/**
 * Attach the Razorpay order the registrant is paying (called by
 * app/api/registrations/order). Public: the registrant has no account. Safe
 * because only the signed webhook can mark it paid, and only at this amount.
 */
export const recordOrder = mutation({
  args: { registrationId: v.id("registrations"), razorpayOrderId: v.string(), amount: v.number() },
  handler: async (ctx, args) => {
    const registration = await ctx.db.get(args.registrationId);
    if (!registration) throw new Error("Registration not found");
    if (registration.status !== "pending_payment") throw new Error("Nothing to pay for this registration");
    if (args.amount !== registration.fee * 100) throw new Error(`Wrong amount: expected ${registration.fee * 100} paise`);
    await ctx.db.patch(args.registrationId, { razorpayOrderId: args.razorpayOrderId });
    return { success: true };
  },
});

/** Verified Razorpay order.paid for a registration fee. Idempotent. */
export const applyRegistrationPayment = internalMutation({
  args: { razorpayOrderId: v.string(), paymentId: v.string(), amount: v.number(), notesRegistrationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const registration = await ctx.db
      .query("registrations")
      .withIndex("by_order", (q) => q.eq("razorpayOrderId", args.razorpayOrderId))
      .first();
    if (!registration) return { applied: false, reason: "unknown order" };
    if (registration.status !== "pending_payment") return { applied: false, reason: "already paid" };
    if (args.notesRegistrationId !== undefined && args.notesRegistrationId !== registration._id) {
      return { applied: false, reason: "registration mismatch" };
    }
    if (args.amount !== registration.fee * 100) return { applied: false, reason: "amount mismatch" };
    await ctx.db.patch(registration._id, { status: "paid", paymentMethod: "razorpay", paymentRef: args.paymentId });
    return { applied: true };
  },
});

/**
 * The registrant paid by scanning the tournament's QR and uploads the
 * screenshot. Public (registrants are anonymous): it only moves an unpaid
 * registration to review, and the owner checks the screenshot before
 * approving.
 */
export const submitPaymentProof = mutation({
  args: { registrationId: v.id("registrations"), proofUrl: v.string() },
  handler: async (ctx, args) => {
    const registration = await ctx.db.get(args.registrationId);
    if (!registration) throw new Error("Registration not found");
    if (registration.status !== "pending_payment") throw new Error("Nothing to pay for this registration");
    const tournament = await ctx.db.get(registration.tournamentId);
    if (!tournament?.settings.paymentQrUrl) throw new Error("This tournament has no payment QR. Pay the organiser directly.");
    if (!isUploadedImage(args.proofUrl)) throw new Error("Upload the payment screenshot with the form's upload button");
    await ctx.db.patch(args.registrationId, { status: "paid", paymentMethod: "qr", paymentProofUrl: args.proofUrl });
    return { success: true };
  },
});

/**
 * The registrant will pay the organiser in person. The entry stays unpaid
 * until an owner marks the fee received (markPaid). Public, like submit.
 */
export const chooseOfflinePayment = mutation({
  args: { registrationId: v.id("registrations") },
  handler: async (ctx, args) => {
    const registration = await ctx.db.get(args.registrationId);
    if (!registration) throw new Error("Registration not found");
    if (registration.status !== "pending_payment") throw new Error("Nothing to pay for this registration");
    await ctx.db.patch(args.registrationId, { paymentMethod: "offline" });
    return { success: true };
  },
});

/** The owner received the fee in person. Owners only; audited. */
export const markPaid = mutation({
  args: { registrationId: v.id("registrations") },
  handler: async (ctx, args) => {
    const registration = await ctx.db.get(args.registrationId);
    if (!registration) throw new Error("Registration not found");
    const admin = await requireTournamentRole(ctx, registration.tournamentId, OWNER_ONLY);
    if (registration.status !== "pending_payment") throw new Error("Already paid");
    await ctx.db.patch(args.registrationId, { status: "paid", paymentMethod: "offline" });
    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: "mark_registration_paid",
      targetType: "registration",
      targetId: args.registrationId,
      previousData: { status: registration.status },
      newData: { status: "paid", paymentMethod: "offline", fee: registration.fee },
      tournamentId: registration.tournamentId,
    });
    return { success: true };
  },
});

/** Change (or clear) a registrant's self-selected category before approval. */
export const setCategory = mutation({
  args: { registrationId: v.id("registrations"), categoryId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const registration = await ctx.db.get(args.registrationId);
    if (!registration) throw new Error("Registration not found");
    await requireTournamentRole(ctx, registration.tournamentId, OWNER_ONLY);
    const tournament = await ctx.db.get(registration.tournamentId);
    if (!tournament) throw new Error("Tournament not found");
    assertKnownCategory(tournament, args.categoryId);
    if (registration.status === "approved") throw new Error("Already approved; change the player's category instead");
    await ctx.db.patch(args.registrationId, { categoryId: args.categoryId });
    return { success: true };
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

  // A category removed since they registered is dropped, not an error.
  const categoryId = (tournament.settings.categories ?? []).some((c) => c.id === registration.categoryId)
    ? registration.categoryId
    : undefined;
  // Same validation, category and plan-limit rules as players:create.
  const playerId = await insertValidatedPlayer(ctx, tournament, {
    categoryId,
    name: registration.name,
    age: registration.age,
    role: registration.role,
    battingBowlingHand: registration.battingBowlingHand,
    phoneNumber: registration.phoneNumber,
    photoUrl: registration.photoUrl,
    jerseyNumber: registration.jerseyNumber,
    jerseyName: registration.jerseyName,
    tshirtSize: registration.tshirtSize,
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
    return {
      status: registration.status,
      fee: registration.fee,
      tournamentId: registration.tournamentId,
      tournamentName: tournament?.name ?? "Tournament",
    };
  },
});
