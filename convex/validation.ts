// convex/validation.ts
// Shared field rules for every create AND update path (tournaments, teams,
// players). Pure functions only — no ctx — so they are unit-testable and the
// create and update paths can never drift apart. Each returns an error message,
// or null when the value is fine.

export const MIN_BASE_PURSE = 100_000; // ₹1 Lakh
export const MAX_BASE_PURSE = 1_000_000_000; // ₹100 Crore
export const MIN_BID_INCREMENT = 5_000;
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
}): string | null {
  const { basePurse, minBidIncrement, maxPlayersPerTeam, basePrice } = settings;

  if (
    !Number.isFinite(basePurse) ||
    basePurse < MIN_BASE_PURSE ||
    basePurse > MAX_BASE_PURSE
  ) {
    return "Base purse must be between ₹1 Lakh and ₹100 Crore";
  }
  if (!Number.isFinite(minBidIncrement) || minBidIncrement < MIN_BID_INCREMENT) {
    return "Minimum bid increment must be at least ₹5,000";
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
  return null;
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
    (!Number.isFinite(fields.basePrice) ||
      fields.basePrice <= 0 ||
      fields.basePrice > tournamentBasePurse)
  ) {
    push(
      "basePrice",
      "Base price must be greater than 0 and no more than the base purse",
    );
  }

  const phone = normalizePhone(fields.phoneNumber);
  if (!phone.ok) push("phoneNumber", phone.error);

  return { errors, phoneNumber: phone.ok ? phone.phone : undefined };
}
