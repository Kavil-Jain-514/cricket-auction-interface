// convex/validation.ts
// Shared field rules for every create AND update path (tournaments, teams,
// players). Pure functions only — no ctx — so they are unit-testable and the
// create and update paths can never drift apart. Each returns an error message,
// or null when the value is fine.
import { isWholeRupees } from "./bidRules";
import { isAllowedPlayerPhoto, isOurUpload } from "./uploads";

/** True when `typed` is the tournament's name (trimmed, any case). */
export function confirmsTournamentName(typed: string, name: string): boolean {
  return typed.trim().toLowerCase() === name.trim().toLowerCase();
}

// No minimum purse or increment: any whole-rupee amount above zero (small
// local tournaments run on a few thousand rupees).
export const MAX_BASE_PURSE = 1_000_000_000; // ₹100 Crore
export const MAX_PLAYERS_PER_TEAM = 50;

function lengthError(
  label: string,
  value: string,
  min: number,
  max?: number,
): string | null {
  const length = value.trim().length;
  if (length < min) return `${label} must be at least ${min} characters`;
  if (max !== undefined && length > max) {
    return `${label} must be at most ${max} characters`;
  }
  return null;
}

export function validateTournamentName(name: string): string | null {
  return lengthError("Tournament name", name, 3, 50);
}

export function validateSettings(settings: {
  basePurse: number;
  minBidIncrement: number;
  maxPlayersPerTeam: number;
  basePrice?: number;
  registrationFee?: number;
  coupleRegistrationFee?: number;
}): string | null {
  const { basePurse, minBidIncrement, maxPlayersPerTeam, basePrice, registrationFee, coupleRegistrationFee } = settings;

  for (const [label, amount] of [
    ["Base purse", basePurse],
    ["Minimum bid increment", minBidIncrement],
    ["Base price", basePrice],
  ] as const) {
    if (amount !== undefined && Number.isFinite(amount) && !isWholeRupees(amount)) {
      return `${label} must be a whole number of rupees`;
    }
  }

  if (
    !Number.isFinite(basePurse) ||
    basePurse <= 0 ||
    basePurse > MAX_BASE_PURSE
  ) {
    return "Base purse must be greater than 0 and at most ₹100 Crore";
  }
  if (!Number.isFinite(minBidIncrement) || minBidIncrement <= 0) {
    return "Minimum bid increment must be greater than 0";
  }
  if (minBidIncrement > basePurse / 10) {
    return "Bid increment cannot exceed 10% of base purse";
  }
  if (
    !Number.isInteger(maxPlayersPerTeam) ||
    maxPlayersPerTeam < 1 ||
    maxPlayersPerTeam > MAX_PLAYERS_PER_TEAM
  ) {
    return `Max players per team must be a whole number between 1 and ${MAX_PLAYERS_PER_TEAM}`;
  }
  if (
    basePrice !== undefined &&
    (!Number.isFinite(basePrice) || basePrice <= 0 || basePrice > basePurse)
  ) {
    return "Base price must be greater than 0 and no more than the base purse";
  }
  return validateRegistrationFee(registrationFee) ?? validateRegistrationFee(coupleRegistrationFee, "Couple registration fee");
}

export const MAX_REGISTRATION_FEE = 100_000;

/** Rupees, 0 (free) to ₹1,00,000; absent is fine. Shared by create and update. */
export function validateRegistrationFee(fee: number | undefined, label = "Registration fee"): string | null {
  if (fee === undefined) return null;
  return Number.isInteger(fee) && fee >= 0 && fee <= MAX_REGISTRATION_FEE
    ? null
    : `${label} must be a whole number of rupees from 0 to 1,00,000`;
}

/**
 * The fee one entry pays, in rupees. In a couple tournament a couple entry
 * pays coupleRegistrationFee (absent = the solo fee); everyone else pays
 * registrationFee. Standard tournaments ignore the couple fee.
 */
export function registrationFeeFor(
  settings: { format?: "standard" | "couple"; registrationFee?: number; coupleRegistrationFee?: number },
  isCouple: boolean,
): number {
  const solo = settings.registrationFee ?? 0;
  const fee = settings.format === "couple" && isCouple ? (settings.coupleRegistrationFee ?? solo) : solo;
  return Math.max(0, fee);
}

export const MAX_FOOTER_TEXT = 120;

/**
 * Trim the optional viewer footer text. Blank means "hidden" (undefined).
 */
export function normalizeFooterText(
  raw: string | undefined,
): { ok: true; text: string | undefined } | { ok: false; error: string } {
  const text = (raw ?? "").trim();
  if (text.length > MAX_FOOTER_TEXT) {
    return {
      ok: false,
      error: `Footer text must be at most ${MAX_FOOTER_TEXT} characters`,
    };
  }
  return { ok: true, text: text === "" ? undefined : text };
}

/**
 * An image we uploaded (uploads.ts), or one already stored here: values saved
 * before the "our uploads only" rule stay editable (AUDIT 2026-11 SEC-004).
 */
function isAcceptedImage(url: string, previous: ReadonlySet<string> | undefined): boolean {
  return previous?.has(url) === true || isOurUpload(url);
}

/** Trim the registration payment QR link. Blank means "none" (undefined). */
export function normalizePaymentQrUrl(
  raw: string,
  previous?: string,
): { ok: true; url: string | undefined } | { ok: false; error: string } {
  const url = raw.trim();
  if (url === "") return { ok: true, url: undefined };
  if (!isAcceptedImage(url, previous ? new Set([previous]) : undefined)) {
    return { ok: false, error: "Upload the payment QR as an image" };
  }
  return { ok: true, url };
}

export const MAX_SPONSORS = 12;

/** Trimmed sponsors for the registration form, or an error. */
export function normalizeSponsors(
  sponsors: Array<{ name: string; logoUrl?: string }>,
  previousLogoUrls?: ReadonlySet<string>,
): { ok: true; sponsors: Array<{ name: string; logoUrl?: string }> } | { ok: false; error: string } {
  if (sponsors.length > MAX_SPONSORS) {
    return { ok: false, error: `Add at most ${MAX_SPONSORS} sponsors` };
  }
  const out: Array<{ name: string; logoUrl?: string }> = [];
  for (const sponsor of sponsors) {
    const error = lengthError("Sponsor name", sponsor.name, 1, 60);
    if (error) return { ok: false, error };
    const logoUrl = sponsor.logoUrl?.trim() || undefined;
    if (logoUrl && !isAcceptedImage(logoUrl, previousLogoUrls)) {
      return { ok: false, error: `Upload ${sponsor.name.trim()}'s logo as an image` };
    }
    out.push(logoUrl ? { name: sponsor.name.trim(), logoUrl } : { name: sponsor.name.trim() });
  }
  return { ok: true, sponsors: out };
}

export function validateTeamColours(primary: string, secondary: string): string | null {
  return HEX_COLOUR.test(primary) && HEX_COLOUR.test(secondary)
    ? null
    : "Team colours must be hex colours like #3B82F6";
}

export function validateTeamName(name: string): string | null {
  return lengthError("Team name", name, 2, 29);
}

export function validateOwnerName(name: string): string | null {
  return lengthError("Owner name", name, 2);
}

export function validatePlayerName(name: string): string | null {
  return lengthError("Player name", name, 2, 49);
}

export function validateJersey(jerseyNumber: number): string | null {
  if (!Number.isInteger(jerseyNumber) || jerseyNumber < 1 || jerseyNumber > 99) {
    return "Jersey number must be between 1 and 99";
  }
  return null;
}

/** 0 means "age not given" (the import fallback); otherwise 5–80. */
export function validateAge(age: number): string | null {
  if (!Number.isFinite(age) || (age !== 0 && (age < 5 || age > 80))) {
    return "Age must be between 5 and 80";
  }
  return null;
}

/**
 * Normalise an Indian mobile number to its 10 digits: strips spaces, dashes
 * and a leading +91 or 0. Blank input is allowed (phone is optional).
 */
export function normalizePhone(
  raw: string | undefined,
): { ok: true; phone: string | undefined } | { ok: false; error: string } {
  const stripped = (raw ?? "").replace(/[\s-]/g, "");
  if (stripped === "") return { ok: true, phone: undefined };
  const digits = stripped.replace(/^(\+91|0)/, "");
  if (!/^[0-9]{10}$/.test(digits)) {
    return { ok: false, error: "Phone number must be 10 digits" };
  }
  return { ok: true, phone: digits };
}

/** Lower-cased, trimmed email address, or null when it doesn't look like one. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

export type FieldError = { field: string; message: string };

/**
 * Validate the player fields that are present (undefined fields are skipped so
 * update can pass a partial patch). Returns every error plus the normalised
 * phone to store.
 */
export function validatePlayerFields(
  fields: {
    name?: string;
    age?: number;
    jerseyNumber?: number;
    phoneNumber?: string;
    basePrice?: number;
    /** Checked only when given; callers leave it out when it didn't change. */
    photoUrl?: string;
  },
  tournamentBasePurse: number,
): { errors: FieldError[]; phoneNumber: string | undefined } {
  const errors: FieldError[] = [];
  const push = (field: string, message: string | null) => {
    if (message) errors.push({ field, message });
  };

  if (fields.name !== undefined) push("name", validatePlayerName(fields.name));
  if (fields.age !== undefined) push("age", validateAge(fields.age));
  if (fields.jerseyNumber !== undefined) {
    push("jerseyNumber", validateJersey(fields.jerseyNumber));
  }
  if (
    fields.basePrice !== undefined &&
    Number.isFinite(fields.basePrice) &&
    !isWholeRupees(fields.basePrice)
  ) {
    push("basePrice", "Base price must be a whole number of rupees");
  } else if (
    fields.basePrice !== undefined &&
    (!Number.isFinite(fields.basePrice) ||
      fields.basePrice <= 0 ||
      fields.basePrice > tournamentBasePurse)
  ) {
    push(
      "basePrice",
      "Base price must be greater than 0 and no more than the base purse",
    );
  }

  if (fields.photoUrl && !isAllowedPlayerPhoto(fields.photoUrl)) {
    push("photoUrl", "Upload the photo with the photo button, or link a Google Drive image");
  }

  const phone = normalizePhone(fields.phoneNumber);
  if (!phone.ok) push("phoneNumber", phone.error);

  return { errors, phoneNumber: phone.ok ? phone.phone : undefined };
}

export const MAX_CATEGORIES = 20;
export const MAX_INCREMENT_SLABS = 10;
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

/** Category list for tournaments.settings.categories (empty is fine). */
export function validateCategories(
  categories: {
    id: string;
    name: string;
    basePrice: number;
    order: number;
    colour: string;
  }[],
  basePurse: number,
): string | null {
  if (categories.length > MAX_CATEGORIES) {
    return `At most ${MAX_CATEGORIES} categories`;
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const c of categories) {
    const name = c.name.trim();
    if (c.id.trim() === "") return "Every category needs an id";
    if (name.length < 1 || name.length > 30) {
      return "Category names must be 1–30 characters";
    }
    if (ids.has(c.id)) return `Duplicate category id "${c.id}"`;
    if (names.has(name.toLowerCase())) {
      return `Duplicate category name "${name}"`;
    }
    ids.add(c.id);
    names.add(name.toLowerCase());
    if (Number.isFinite(c.basePrice) && !isWholeRupees(c.basePrice)) {
      return `${name}: base price must be a whole number of rupees`;
    }
    if (
      !Number.isFinite(c.basePrice) ||
      c.basePrice <= 0 ||
      c.basePrice > basePurse
    ) {
      return `${name}: base price must be greater than 0 and no more than the base purse`;
    }
    if (!Number.isFinite(c.order)) return `${name}: order must be a number`;
    if (!HEX_COLOUR.test(c.colour)) {
      return `${name}: colour must be a hex value like #f59e0b`;
    }
  }
  return null;
}

/**
 * Increment slabs: thresholds strictly ascending from ₹0 up, each increment
 * held to the same bounds as minBidIncrement.
 */
export function validateIncrementSlabs(
  slabs: { fromAmount: number; increment: number }[],
  basePurse: number,
): string | null {
  if (slabs.length > MAX_INCREMENT_SLABS) {
    return `At most ${MAX_INCREMENT_SLABS} increment slabs`;
  }
  let previous = -1;
  for (const slab of slabs) {
    if (
      (Number.isFinite(slab.fromAmount) && !isWholeRupees(slab.fromAmount)) ||
      (Number.isFinite(slab.increment) && !isWholeRupees(slab.increment))
    ) {
      return "Slab amounts must be whole numbers of rupees";
    }
    if (!Number.isFinite(slab.fromAmount) || slab.fromAmount < 0) {
      return "Slab thresholds must be ₹0 or more";
    }
    if (slab.fromAmount <= previous) {
      return "Slab thresholds must be in ascending order with no duplicates";
    }
    previous = slab.fromAmount;
    if (
      !Number.isFinite(slab.increment) ||
      slab.increment <= 0 ||
      slab.increment > basePurse / 10
    ) {
      return "Each slab increment must be greater than 0 and at most 10% of the base purse";
    }
  }
  return null;
}

export const MAX_SQUAD_RULES = 20;
const SQUAD_RULE_ROLE_NAMES = ["Batter", "Bowler", "All-Rounder", "Wicket Keeper"];

/**
 * Squad rules: each targets exactly one known category or role, has a min
 * and/or max (whole numbers within the squad size, min <= max), and all the
 * minimums together fit in one squad.
 */
export function validateSquadRules(
  rules: {
    id: string;
    categoryId?: string;
    role?: string;
    min?: number;
    max?: number;
  }[],
  categoryIds: string[],
  maxPlayersPerTeam: number,
): string | null {
  if (rules.length > MAX_SQUAD_RULES) return `At most ${MAX_SQUAD_RULES} squad rules`;
  const ids = new Set<string>();
  let totalMin = 0;
  for (const rule of rules) {
    if (rule.id.trim() === "" || ids.has(rule.id)) {
      return "Every squad rule needs a unique id";
    }
    ids.add(rule.id);
    if ((rule.categoryId === undefined) === (rule.role === undefined)) {
      return "Each squad rule applies to exactly one category or role";
    }
    if (rule.categoryId !== undefined && !categoryIds.includes(rule.categoryId)) {
      return "A squad rule refers to a category that doesn't exist";
    }
    if (rule.role !== undefined && !SQUAD_RULE_ROLE_NAMES.includes(rule.role)) {
      return `Unknown role "${rule.role}" in a squad rule`;
    }
    if (rule.min === undefined && rule.max === undefined) {
      return "Each squad rule needs a minimum, a maximum, or both";
    }
    for (const n of [rule.min, rule.max]) {
      if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > maxPlayersPerTeam)) {
        return `Squad rule limits must be whole numbers from 0 to ${maxPlayersPerTeam}`;
      }
    }
    if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
      return "A squad rule's minimum can't be more than its maximum";
    }
    totalMin += rule.min ?? 0;
  }
  if (totalMin > maxPlayersPerTeam) {
    return `The squad minimums add up to ${totalMin}, more than the squad size of ${maxPlayersPerTeam}`;
  }
  return null;
}

/** The female member of a couple entry (schema: partnerValidator). */
export type Partner = {
  phoneNumber?: string; // required by validateEntryFormat
  age?: number;
  role: string[];
  battingBowlingHand: "Right-handed" | "Left-handed";
  tshirtSize?: "XS" | "S" | "M" | "L" | "XL" | "XXL" | "3XL" | "4XL";
  jerseyNumber?: number;
  ranking?: number;
};

/** The types a couple member picks one of (Allrounder, Bat, Bowl on the form). */
export const COUPLE_TYPES = ["All-Rounder", "Batter", "Bowler"];

/** Rankings a couple-tournament entry may pick (the forms' dropdown). */
export const RANKING_OPTIONS = [7, 8, 9, 10] as const;

function rankingError(ranking: number | undefined, label: string): string | null {
  if (ranking === undefined) return `${label} is required`;
  return (RANKING_OPTIONS as readonly number[]).includes(ranking) ? null : `${label} must be 7, 8, 9 or 10`;
}

function coupleTypeError(role: readonly string[] | undefined): string | null {
  if (!role || role.length === 0) return null; // left blank: the required-field rules decide
  return role.length === 1 && COUPLE_TYPES.includes(role[0]) ? null : "Choose one type: Allrounder, Bat or Bowl";
}

/**
 * The tournament-format fields of one entry (registration or player), for
 * every path: submit, approval, players:create and players:update (which
 * passes the merged entry). Standard tournaments take none of them. In a
 * couple tournament every entry has a ranking; a couple entry has a partner
 * (the female member) and one type per member, and a solo entry a gender.
 * Returns the partner to store, with its phone normalised.
 */
export function validateEntryFormat(
  tournament: { settings: { format?: "standard" | "couple" } },
  entry: {
    gender?: "male" | "female";
    ranking?: number;
    partner?: Partner;
    role?: readonly string[];
    phoneNumber?: string;
  },
): { ok: true; partner: Partner | undefined } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const { gender, ranking, partner } = entry;
  if (tournament.settings.format !== "couple") {
    return gender === undefined && ranking === undefined && partner === undefined
      ? { ok: true, partner: undefined }
      : fail("Couple and solo details are only for couple tournaments");
  }

  if (!partner) {
    if (gender === undefined) return fail("Gender is required: choose Male or Female");
    const error = rankingError(ranking, "Ranking");
    return error ? fail(error) : { ok: true, partner: undefined };
  }

  if (gender !== undefined) return fail("A couple entry has no gender: remove the partner to make it a solo entry");
  const maleError = rankingError(ranking, "Ranking") ?? coupleTypeError(entry.role);
  if (maleError) return fail(maleError);

  const male = normalizePhone(entry.phoneNumber);
  // The partner's phone, age and jersey number follow the player rules.
  const { errors, phoneNumber } = validatePlayerFields(
    { age: partner.age, jerseyNumber: partner.jerseyNumber, phoneNumber: partner.phoneNumber },
    0, // no base price to check
  );
  const female =
    errors[0]?.message ??
    (phoneNumber === undefined ? "Phone number is required" : null) ??
    (male.ok && phoneNumber === male.phone ? "Use a different phone number from the male member" : null) ??
    coupleTypeError(partner.role) ??
    rankingError(partner.ranking, "Ranking");
  if (female) return fail(`Female: ${female}`);
  return { ok: true, partner: { ...partner, phoneNumber } };
}
