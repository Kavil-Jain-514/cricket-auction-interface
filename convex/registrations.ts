// convex/registrations.ts - Public player registration (/register/<id>).
// Anyone can submit while the organiser has registration open; an optional
// fee is paid by scanning the organiser's QR and uploading a screenshot, in
// person (the owner marks it paid), or through Razorpay (the signed webhook
// in http.ts marks it paid). The organiser approves, which creates the
// player through the same validation as players:create. Registrants may pick
// a category; they can never set auction fields such as price or status.
import { ConvexError, v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { consumeShardedRateLimit } from "./shardedRateLimit";
import { logAdminAction, OWNER_ONLY, REVIEW_REGISTRATIONS, requireTournamentRole } from "./auth";
import { syncTournamentAuctionCounts } from "./auctionCounts";
import { insertValidatedPlayer } from "./players";
import { normalizePhone, registrationFeeFor, validateEntryFormat, validatePlayerFields } from "./validation";
import { cloudinarySignature } from "./cloudinarySignature";
import { cloudinaryPublicId, isOurUpload, ourCloudName } from "./uploads";
import { answersValidator, missingPartnerField, missingRequiredField, resolveRequiredFields, validateAnswers } from "./registrationForm";
import { genderValidator, partnerValidator } from "./ruleValidators";
import { customQuestionsEnabled, latestFormVersion } from "./registrationForms";
import { enqueueRegistrationNotification } from "./notifications";

const MAX_PER_PHONE_PER_DAY = 3;
// Per tournament, whatever the phone: a spammer rotating numbers is capped,
// a real registration rush (a link shared in a big group, hundreds of people
// in the same minute) stays under it. Each registrant may need two or three
// uploads (photo, payment screenshot, file answers), hence the higher upload
// cap. The daily upload cap and MAX_PER_PHONE_PER_DAY are what bound abuse.
// All three are sharded (convex/shardedRateLimit.ts) so a rush doesn't
// serialise on one row; the effective cap is up to 63 above the number here.
export const SUBMIT_LIMIT = { limit: 600, windowMs: 60 * 1000 };
export const UPLOAD_SIGNATURE_LIMIT = { limit: 900, windowMs: 60 * 1000 };
// And per day, so a tournament can't be used as free image hosting.
export const UPLOAD_DAILY_LIMIT = { limit: 2000, windowMs: 24 * 60 * 60 * 1000 };
/** How long an upload may wait for its registration to be submitted. */
const UPLOAD_GRANT_TTL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PHOTO_FOLDER = "cricket-auction/registrations";
const PHOTO_FORMATS = "jpg,jpeg,png,webp";

const tshirtSize = v.optional(
  v.union(v.literal("XS"), v.literal("S"), v.literal("M"), v.literal("L"), v.literal("XL"), v.literal("XXL"), v.literal("3XL"), v.literal("4XL")),
);

// The form's random device id (lib/deviceId.ts): a UUID in practice.
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const RELOAD = "Reload the page and try again.";

const duplicateKey = (name: string, phone: string | undefined) => `${name.trim().toLowerCase()}|${phone ?? ""}`;

/** Normalised phone of a stored player, tolerating legacy formats. */
function playerPhone(p: Doc<"players">): string | undefined {
  const phone = normalizePhone(p.phoneNumber);
  return phone.ok ? phone.phone : p.phoneNumber;
}

/** A file a registrant uploaded through getUploadSignature (AUDIT 2026-11 SEC-004). */
const isUploadedImage = (url: string) => isOurUpload(url, "registrations");

/** Throws unless `categoryId` is absent or one of the tournament's categories. */
function assertKnownCategory(tournament: Doc<"tournaments">, categoryId: string | undefined) {
  if (categoryId !== undefined && !(tournament.settings.categories ?? []).some((c) => c.id === categoryId)) {
    throw new ConvexError("Pick a category from the tournament's list");
  }
}

/** Whether the public form takes entries: the same rule for the page, uploads and submit. */
function registrationIsOpen(tournament: Doc<"tournaments"> | null): tournament is Doc<"tournaments"> {
  return !!tournament && tournament.isActive !== false && tournament.settings.registrationOpen === true && tournament.status !== "completed";
}

/** Cloudinary signing config, or null when photo upload isn't set up. */
function uploadConfig(): { cloudName: string; apiKey: string; apiSecret: string } | null {
  const cloudName = ourCloudName();
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}
const UPLOAD_NOT_SET_UP = "Photo upload isn't set up; you can register without a photo";

/**
 * Name, logo, sponsors, fee, payment QR, categories, the organiser's own
 * questions (archived ones left out) and whether the form is open. Public and
 * identity-free; nothing private.
 */
export const getPublicInfo = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament || tournament.isActive === false) return null;
    const latest = await latestFormVersion(ctx, args.tournamentId);
    const form = customQuestionsEnabled() ? latest : null;
    return {
      form: form ? { version: form.version, questions: form.questions.filter((q) => !q.archived) } : null,
      // Which standard details are required; the custom-question switch doesn't touch these.
      requiredFields: resolveRequiredFields(latest?.requiredFields),
      name: tournament.name,
      description: tournament.description,
      logoUrl: tournament.logoUrl,
      organizationLogoUrl: tournament.organizationLogoUrl,
      open: registrationIsOpen(tournament),
      format: tournament.settings.format ?? "standard",
      onePerDevice: tournament.settings.oneRegistrationPerDevice === true,
      fee: registrationFeeFor(tournament.settings, false),
      // Couple tournaments: what a couple entry pays (= fee elsewhere).
      coupleFee: registrationFeeFor(tournament.settings, true),
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
    // The signature names one random file (public_id), recorded as a grant
    // that submit consumes: a signature can't be reused for more uploads,
    // and an upload can back one registration only (AUDIT 2026-11 SEC-003).
    // issueUploadGrant also checks registration is open and upload is set up,
    // in the same transaction (one round trip instead of a query + mutation).
    const publicId = crypto.randomUUID().replace(/-/g, "");
    const grant = { tournamentId: args.tournamentId, publicId: `${PHOTO_FOLDER}/${publicId}` };
    // The client doesn't resend actions, so a grant that lost a write
    // conflict on every OCC retry is tried again here. A ConvexError is the
    // server's answer (closed, busy) and goes straight back; anything else
    // means the mutation didn't commit, so another try can't double-count.
    for (let attempt = 1; ; attempt++) {
      try {
        await ctx.runMutation(internal.registrations.issueUploadGrant, grant);
        break;
      } catch (error) {
        if (error instanceof ConvexError || attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 250));
      }
    }
    const config = uploadConfig();
    if (!config) throw new ConvexError(UPLOAD_NOT_SET_UP);
    const { cloudName, apiKey, apiSecret } = config;
    const params = {
      allowed_formats: PHOTO_FORMATS,
      folder: PHOTO_FOLDER,
      public_id: publicId,
      timestamp: Math.floor(Date.now() / 1000),
    };
    return { cloudName, apiKey, ...params, signature: await cloudinarySignature(params, apiSecret) };
  },
});

/**
 * Check registration is open and upload is set up, count the upload against
 * the tournament's limits and record its grant. Throws the message the form
 * shows; a refusal rolls back, so it uses neither the per-minute nor the
 * daily budget. The random publicId seeds the shard.
 */
export const issueUploadGrant = internalMutation({
  args: { tournamentId: v.id("tournaments"), publicId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    if (!registrationIsOpen(await ctx.db.get(args.tournamentId))) throw new ConvexError("Registration is closed");
    if (!uploadConfig()) throw new ConvexError(UPLOAD_NOT_SET_UP);
    const busy = "Too many uploads right now. Try again in a minute.";
    if (!(await consumeShardedRateLimit(ctx, `upload:${args.tournamentId}`, UPLOAD_SIGNATURE_LIMIT, args.publicId))) {
      throw new ConvexError(busy);
    }
    if (!(await consumeShardedRateLimit(ctx, `upload-day:${args.tournamentId}`, UPLOAD_DAILY_LIMIT, args.publicId))) {
      throw new ConvexError(busy);
    }
    await ctx.db.insert("uploadGrants", { ...args, expiresAt: Date.now() + UPLOAD_GRANT_TTL_MS });
  },
});

/**
 * Use up the grant behind a registrant's uploaded file: it must have been
 * signed for this tournament, not yet used and not expired. Throws `message`
 * otherwise. Without a configured cloud name there are no grants to check
 * (as before SEC-003).
 */
async function consumeUploadGrant(
  ctx: MutationCtx,
  url: string,
  tournamentId: Id<"tournaments">,
  message: string,
): Promise<void> {
  const cloud = ourCloudName();
  if (!cloud) return;
  const publicId = cloudinaryPublicId(url, cloud);
  const grant = publicId
    ? await ctx.db
        .query("uploadGrants")
        .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
        .first()
    : null;
  if (!grant || grant.tournamentId !== tournamentId || grant.usedAt !== undefined || grant.expiresAt < Date.now()) {
    throw new ConvexError(message);
  }
  await ctx.db.patch(grant._id, { usedAt: Date.now() });
}

/**
 * Validate the registrant's answers against the live form. They must answer
 * the version they were shown; an edit since means a reload. Returns what to
 * store (undefined when the tournament asks nothing of its own).
 */
async function checkAnswers(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  answers: Doc<"registrations">["answers"],
): Promise<Doc<"registrations">["answers"]> {
  if (!customQuestionsEnabled()) return undefined;
  const form = await latestFormVersion(ctx, tournamentId);
  if (answers && answers.formVersion !== (form?.version ?? 0)) {
    throw new ConvexError("The organiser just updated this form. Reload the page and fill it in again.");
  }
  if (!form) return undefined;
  const { errors, cleaned } = validateAnswers(form.questions, answers?.values ?? []);
  if (errors.length > 0) throw new ConvexError(errors[0].message);
  // File answers are registrant uploads too: each needs its own grant.
  const fileQuestions = new Set(form.questions.filter((q) => q.type === "file").map((q) => q.id));
  for (const a of cleaned) {
    if (fileQuestions.has(a.questionId) && typeof a.value === "string") {
      await consumeUploadGrant(ctx, a.value, tournamentId, "Upload the file again with the form's upload button");
    }
  }
  return cleaned.length > 0 ? { formVersion: form.version, values: cleaned } : undefined;
}

/**
 * Public, anonymous registration. Only player profile fields are accepted
 * (no auctionStatus, basePrice or category). `website` is a honeypot: humans
 * never see it, so anything in it means a bot, which gets a fake success.
 */
export const submit = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.string(),
    age: v.optional(v.number()),
    role: v.array(v.string()),
    battingBowlingHand: v.union(v.literal("Right-handed"), v.literal("Left-handed")),
    phoneNumber: v.string(),
    photoUrl: v.optional(v.string()),
    jerseyNumber: v.optional(v.number()),
    jerseyName: v.optional(v.string()),
    tshirtSize,
    categoryId: v.optional(v.string()),
    consentWhatsApp: v.boolean(),
    // Answers to the organiser's own questions (registrationForm.ts).
    answers: v.optional(answersValidator),
    // The browser's random id, for the organiser's one-per-device setting.
    deviceId: v.optional(v.string()),
    // Couple tournaments only (validateEntryFormat): a couple sends the
    // female member as `partner`; a solo entry sends `gender`.
    gender: genderValidator,
    ranking: v.optional(v.number()),
    partner: v.optional(partnerValidator),
    website: v.string(),
  },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament || tournament.isActive === false) throw new ConvexError("Tournament not found");
    if (!tournament.settings.registrationOpen || tournament.status === "completed") {
      throw new ConvexError("Registration is closed for this tournament");
    }
    if (args.website.trim() !== "") return { success: true as const, needsPayment: false, fee: 0 };
    // A server-side random seed: the shard is never the client's choice
    // (shardedRateLimit.ts). Convex seeds Math.random per mutation.
    if (!(await consumeShardedRateLimit(ctx, `register:${args.tournamentId}`, SUBMIT_LIMIT, String(Math.random())))) {
      throw new ConvexError("Too many registrations right now. Try again in a minute.");
    }

    const { website: _honeypot, consentWhatsApp, tournamentId, categoryId, answers: rawAnswers, deviceId, partner: rawPartner, ...fields } = args;
    if (deviceId !== undefined && !DEVICE_ID.test(deviceId)) throw new ConvexError(RELOAD);
    const onePerDevice = tournament.settings.oneRegistrationPerDevice === true;
    if (onePerDevice && deviceId === undefined) throw new ConvexError(RELOAD);
    const { errors, phoneNumber } = validatePlayerFields(fields, tournament.settings.basePurse);
    if (errors.length > 0) throw new ConvexError(errors[0].message);
    if (!phoneNumber) throw new ConvexError("Phone number is required");
    const format = validateEntryFormat(tournament, { ...fields, partner: rawPartner });
    if (!format.ok) throw new ConvexError(format.error);
    const partner = format.partner;
    const required = resolveRequiredFields((await latestFormVersion(ctx, tournamentId))?.requiredFields);
    // The same toggles apply to both members of a couple; couples have no
    // name on the jersey.
    const missing =
      missingRequiredField(partner ? { ...required, jerseyName: false } : required, { ...fields, categoryId }, {
        hasCategories: (tournament.settings.categories ?? []).length > 0,
      }) ?? (partner ? missingPartnerField(required, partner) : null);
    if (missing) throw new ConvexError(missing);
    if (fields.photoUrl && !isUploadedImage(fields.photoUrl)) {
      throw new ConvexError("Upload your photo with the form's photo button");
    }

    // Same person (name + phone) before any upload grant is used: a retry
    // after a lost answer carries the photo the first attempt already used,
    // and must reach this check rather than "upload your photo again".
    // Indexed on the normalised phone: no full roster scan on a public path.
    // (Approval re-checks against every player, legacy phone formats too.)
    const now = Date.now();
    const samePhone = await ctx.db
      .query("registrations")
      .withIndex("by_tournament_phone", (q) => q.eq("tournamentId", tournamentId).eq("phoneNumber", phoneNumber))
      .collect();
    const key = duplicateKey(fields.name, phoneNumber);
    const existing = samePhone.find((r) => r.status !== "rejected" && duplicateKey(r.name, r.phoneNumber) === key);
    // The same browser that made it (its random device id, never shown to
    // anyone else) gets it back, so a lost answer still reaches the payment
    // step. Anyone else, who may only know the name and phone, gets the
    // error and no id. Nothing is written for this answer.
    if (existing && deviceId !== undefined && existing.deviceId === deviceId) {
      return {
        success: true as const,
        alreadyRegistered: true as const,
        registrationId: existing._id,
        needsPayment: existing.status === "pending_payment",
        fee: existing.fee,
      };
    }
    const playersWithPhone = await ctx.db
      .query("players")
      .withIndex("by_tournament_phone", (q) => q.eq("tournamentId", tournamentId).eq("phoneNumber", phoneNumber))
      .collect();
    if (existing || playersWithPhone.some((p) => duplicateKey(p.name, playerPhone(p)) === key)) {
      throw new ConvexError(`${fields.name.trim()} is already registered for this tournament`);
    }
    if (samePhone.filter((r) => r.createdAt > now - DAY_MS).length >= MAX_PER_PHONE_PER_DAY) {
      throw new ConvexError("Too many registrations from this phone number today. Try again tomorrow.");
    }

    if (fields.photoUrl) {
      await consumeUploadGrant(ctx, fields.photoUrl, tournamentId, "Upload your photo again with the form's photo button");
    }
    assertKnownCategory(tournament, categoryId);
    const answers = await checkAnswers(ctx, tournamentId, rawAnswers);
    // After the name + phone check, so the same person retrying hears they're
    // registered (the form shows that as success), not about the device.
    // Indexed on (tournament, device): only the same device ever conflicts.
    if (onePerDevice) {
      const fromDevice = await ctx.db
        .query("registrations")
        .withIndex("by_tournament_device", (q) => q.eq("tournamentId", tournamentId).eq("deviceId", deviceId))
        .collect();
      if (fromDevice.some((r) => r.status !== "rejected")) {
        throw new ConvexError(
          "This device has already been used to register for this tournament. To register someone else, use their phone or ask the organiser.",
        );
      }
    }

    const fee = registrationFeeFor(tournament.settings, partner !== undefined);
    const registrationId = await ctx.db.insert("registrations", {
      ...fields,
      name: fields.name.trim(),
      tournamentId,
      phoneNumber,
      categoryId,
      consentWhatsApp,
      answers,
      deviceId,
      partner,
      status: fee > 0 ? "pending_payment" : "paid",
      fee,
      createdAt: now,
    });
    // Only queues a message (if they opted in); sending happens elsewhere and
    // can never fail the registration.
    const registration = await ctx.db.get(registrationId);
    if (registration) await enqueueRegistrationNotification(ctx, "registration_received", { registration, tournament });
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
    if (!registration) throw new ConvexError("Registration not found");
    if (registration.status !== "pending_payment") throw new ConvexError("Nothing to pay for this registration");
    if (args.amount !== registration.fee * 100) throw new ConvexError(`Wrong amount: expected ${registration.fee * 100} paise`);
    const existing = await ctx.db
      .query("registrationOrders")
      .withIndex("by_order", (q) => q.eq("razorpayOrderId", args.razorpayOrderId))
      .first();
    if (existing) throw new ConvexError("That order is already recorded");
    const orders = await ctx.db
      .query("registrationOrders")
      .withIndex("by_registration", (q) => q.eq("registrationId", registration._id))
      .take(MAX_ORDERS_PER_REGISTRATION);
    if (orders.length >= MAX_ORDERS_PER_REGISTRATION) {
      throw new ConvexError("Too many payment attempts for this registration. Contact the organiser.");
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
    await ctx.db.patch(registration._id, { status: "paid", paymentMethod: "razorpay", paymentRef: args.paymentId });
    if (order) await ctx.db.patch(order._id, { status: "paid", paymentRef: args.paymentId, paidAt: now });
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
    if (!registration) throw new ConvexError("Registration not found");
    if (registration.status !== "pending_payment") throw new ConvexError("Nothing to pay for this registration");
    const tournament = await ctx.db.get(registration.tournamentId);
    if (!tournament?.settings.paymentQrUrl) throw new ConvexError("This tournament has no payment QR. Pay the organiser directly.");
    if (!isUploadedImage(args.proofUrl)) throw new ConvexError("Upload the payment screenshot with the form's upload button");
    await consumeUploadGrant(
      ctx,
      args.proofUrl,
      registration.tournamentId,
      "Upload the payment screenshot again with the form's upload button",
    );
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
    if (!registration) throw new ConvexError("Registration not found");
    if (registration.status !== "pending_payment") throw new ConvexError("Nothing to pay for this registration");
    await ctx.db.patch(args.registrationId, { paymentMethod: "offline" });
    return { success: true };
  },
});

/** The fee was received in person. Owners and registration admins; audited. */
export const markPaid = mutation({
  args: { registrationId: v.id("registrations") },
  handler: async (ctx, args) => {
    const registration = await ctx.db.get(args.registrationId);
    if (!registration) throw new ConvexError("Registration not found");
    const admin = await requireTournamentRole(ctx, registration.tournamentId, REVIEW_REGISTRATIONS);
    if (registration.status !== "pending_payment") throw new ConvexError("Already paid");
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
    if (!registration) throw new ConvexError("Registration not found");
    await requireTournamentRole(ctx, registration.tournamentId, REVIEW_REGISTRATIONS);
    const tournament = await ctx.db.get(registration.tournamentId);
    if (!tournament) throw new ConvexError("Tournament not found");
    assertKnownCategory(tournament, args.categoryId);
    if (registration.status === "approved") throw new ConvexError("Already approved; change the player's category instead");
    await ctx.db.patch(args.registrationId, { categoryId: args.categoryId });
    return { success: true };
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

/** Review list (owners and registration admins), newest first, with duplicates flagged. Includes phones. */
export const list = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireTournamentRole(ctx, args.tournamentId, REVIEW_REGISTRATIONS);
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

/**
 * Counts for the tournament page's Registrations button: ready to review,
 * waiting for payment, and the current fee (0 = free). Reviewers only.
 */
export const summary = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireTournamentRole(ctx, args.tournamentId, REVIEW_REGISTRATIONS);
    const tournament = await ctx.db.get(args.tournamentId);
    let ready = 0;
    let awaitingPayment = 0;
    for await (const r of ctx.db
      .query("registrations")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))) {
      if (r.status === "paid") ready++;
      else if (r.status === "pending_payment") awaitingPayment++;
    }
    return {
      ready,
      awaitingPayment,
      fee: tournament ? registrationFeeFor(tournament.settings, false) : 0,
      coupleFee: tournament ? registrationFeeFor(tournament.settings, true) : 0,
    };
  },
});

/**
 * What approvals need to know about the roster: who is already a player
 * (name + phone) and its size and next number. Loaded once per call and
 * kept up to date in memory as players are added, so approving many
 * registrations reads the players table once, not twice per registration
 * (AUDIT 2026-11 PERF-003).
 */
type Roster = { keys: Set<string>; count: number; nextPlayerNumber: number };

async function loadRoster(ctx: MutationCtx, tournamentId: Id<"tournaments">): Promise<Roster> {
  const players = await ctx.db
    .query("players")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
    .collect();
  return {
    keys: new Set(players.map((p) => duplicateKey(p.name, playerPhone(p)))),
    count: players.length,
    nextPlayerNumber: players.reduce((max, p) => Math.max(max, p.playerNumber || 0), 0) + 1,
  };
}

async function approveOne(
  ctx: MutationCtx,
  registration: Doc<"registrations">,
  admin: Doc<"users">,
  tournament: Doc<"tournaments">,
  roster: Roster,
): Promise<Id<"players">> {
  if (registration.status !== "paid") {
    throw new ConvexError(registration.status === "pending_payment" ? "Not paid yet" : `Already ${registration.status}`);
  }
  const key = duplicateKey(registration.name, registration.phoneNumber);
  if (roster.keys.has(key)) {
    throw new ConvexError(`${registration.name} is already a player`);
  }

  // A category removed since they registered is dropped, not an error.
  const categoryId = (tournament.settings.categories ?? []).some((c) => c.id === registration.categoryId)
    ? registration.categoryId
    : undefined;
  // Same validation, category and plan-limit rules as players:create.
  const playerId = await insertValidatedPlayer(
    ctx,
    tournament,
    {
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
      consentWhatsApp: registration.consentWhatsApp,
      gender: registration.gender,
      ranking: registration.ranking,
      partner: registration.partner,
    },
    { count: roster.count, nextPlayerNumber: roster.nextPlayerNumber },
  );
  roster.keys.add(key);
  roster.count++;
  roster.nextPlayerNumber++;
  await ctx.db.patch(registration._id, { status: "approved", playerId, reviewedAt: Date.now() });
  await enqueueRegistrationNotification(ctx, "registration_approved", { registration, tournament, playerId });
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

/** Approve one registration: creates the player. Owners and registration admins. */
export const approve = mutation({
  args: { registrationId: v.id("registrations") },
  handler: async (ctx, args) => {
    const registration = await ctx.db.get(args.registrationId);
    if (!registration) throw new ConvexError("Registration not found");
    const admin = await requireTournamentRole(ctx, registration.tournamentId, REVIEW_REGISTRATIONS);
    const tournament = await ctx.db.get(registration.tournamentId);
    if (!tournament) throw new ConvexError("Tournament not found");
    const playerId = await approveOne(ctx, registration, admin, tournament, await loadRoster(ctx, tournament._id));
    await syncTournamentAuctionCounts(ctx, registration.tournamentId);
    return playerId;
  },
});

/** Registrations approved per bulkApprove call: keeps each call well inside one transaction. */
const BULK_APPROVE_BATCH = 50;

/**
 * Approve the ready (paid) registrations, oldest first, BULK_APPROVE_BATCH
 * per call. Failures (duplicates, the plan limit) are reported, not fatal.
 * Pass the returned `after` back to continue; failed ones stay "paid", so
 * resuming by position (not by status) is what makes the loop end.
 */
export const bulkApprove = mutation({
  args: { tournamentId: v.id("tournaments"), after: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const admin = await requireTournamentRole(ctx, args.tournamentId, REVIEW_REGISTRATIONS);
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) throw new ConvexError("Tournament not found");
    const ready = (
      await ctx.db
        .query("registrations")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect()
    )
      .filter((r) => r.status === "paid" && (args.after === undefined || r.createdAt > args.after))
      .sort((a, b) => a.createdAt - b.createdAt);
    const batch = ready.slice(0, BULK_APPROVE_BATCH);

    const roster = await loadRoster(ctx, args.tournamentId);
    let approved = 0;
    const failed: Array<{ registrationId: Id<"registrations">; name: string; reason: string }> = [];
    for (const registration of batch) {
      try {
        await approveOne(ctx, registration, admin, tournament, roster);
        approved++;
      } catch (error) {
        failed.push({ registrationId: registration._id, name: registration.name, reason: (error as Error).message });
      }
    }
    if (approved > 0) await syncTournamentAuctionCounts(ctx, args.tournamentId);
    return {
      approved,
      failed,
      remaining: ready.length - batch.length,
      // Resume point for the next call (createdAt of the last one tried).
      after: batch.at(-1)?.createdAt ?? args.after,
    };
  },
});

/** Reject with a reason (kept on the registration and in the audit log). */
export const reject = mutation({
  args: { registrationId: v.id("registrations"), reason: v.string() },
  handler: async (ctx, args) => {
    const registration = await ctx.db.get(args.registrationId);
    if (!registration) throw new ConvexError("Registration not found");
    const admin = await requireTournamentRole(ctx, registration.tournamentId, REVIEW_REGISTRATIONS);
    const reason = args.reason.trim();
    if (!reason) throw new ConvexError("A reason is required");
    if (registration.status === "approved") throw new ConvexError("Already approved; delete the player instead");
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
    const orders = await ctx.db
      .query("registrationOrders")
      .withIndex("by_registration", (q) => q.eq("registrationId", registration._id))
      .take(MAX_ORDERS_PER_REGISTRATION);
    return {
      status: registration.status,
      fee: registration.fee,
      ordersLeft: Math.max(0, MAX_ORDERS_PER_REGISTRATION - orders.length),
      tournamentId: registration.tournamentId,
      tournamentName: tournament?.name ?? "Tournament",
    };
  },
});
