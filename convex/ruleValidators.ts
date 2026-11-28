// convex/ruleValidators.ts
// Argument/schema validators for the auction-rule settings, shared by
// schema.ts and the tournaments mutations so the two can't drift.
import { v } from "convex/values";

export const categoryValidator = v.object({
  id: v.string(),
  name: v.string(),
  basePrice: v.number(),
  order: v.number(),
  colour: v.string(),
});

export const incrementSlabValidator = v.object({
  fromAmount: v.number(),
  increment: v.number(),
});

export const presentationOrderValidator = v.optional(
  v.union(v.literal("random"), v.literal("by_category")),
);

export const squadRuleValidator = v.object({
  id: v.string(),
  categoryId: v.optional(v.string()),
  role: v.optional(v.string()),
  min: v.optional(v.number()),
  max: v.optional(v.number()),
});

export const sponsorValidator = v.object({
  name: v.string(),
  // e.g. "Title Sponsor"; shown above the logo on the registration form.
  type: v.optional(v.string()),
  logoUrl: v.optional(v.string()),
});

export const planTierValidator = v.union(
  v.literal("free"),
  v.literal("club"),
  v.literal("league"),
  v.literal("pro"),
);

export const planValidator = v.object({
  tier: planTierValidator,
  maxTeams: v.number(),
  maxPlayers: v.number(),
  paidAt: v.optional(v.number()),
  // Razorpay payment id (or "manual: <reason>" for a super-admin grant).
  paymentRef: v.optional(v.string()),
});

// Couple tournaments (settings.format "couple"). Absent = "standard".
export const tournamentFormatValidator = v.optional(v.union(v.literal("standard"), v.literal("couple")));

export const tshirtSizeValidator = v.union(
  v.literal("XS"),
  v.literal("S"),
  v.literal("M"),
  v.literal("L"),
  v.literal("XL"),
  v.literal("XXL"),
  v.literal("3XL"),
  v.literal("4XL"),
);

/** Solo entries in a couple tournament only. */
export const genderValidator = v.optional(v.union(v.literal("male"), v.literal("female")));

/**
 * The female member of a couple entry. The male member is the row's own
 * fields, so the auction treats a couple as one player.
 */
/** The female member as stored (schema). */
export const storedPartnerValidator = v.object({
  // Normalised 10 digits, private like the row's own phone. Always present on
  // stored entries (validateEntryFormat requires it); optional so the public
  // projection without it (toPublicPlayer) still has the document's type.
  phoneNumber: v.optional(v.string()),
  age: v.optional(v.number()),
  role: v.array(v.string()), // one type, or empty when the organiser made role optional
  battingBowlingHand: v.union(v.literal("Right-handed"), v.literal("Left-handed")),
  tshirtSize: v.optional(tshirtSizeValidator),
  jerseyNumber: v.optional(v.number()),
  // Legacy: couple tournaments used to ask for a ranking (categories do that
  // job now). Kept so older documents stay valid; nothing writes or shows it.
  ranking: v.optional(v.number()),
});

/** The female member as the forms send it: no ranking. */
export const partnerValidator = storedPartnerValidator.omit("ranking");
