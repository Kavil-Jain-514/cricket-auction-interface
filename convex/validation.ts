// convex/validation.ts
// Shared field rules for every create AND update path (tournaments, teams,
// players). Pure functions only — no ctx — so they are unit-testable and the
// create and update paths can never drift apart. Each returns an error message,
// or null when the value is fine.
import { isWholeRupees } from "./bidRules";

/** True when `typed` is the tournament's name (trimmed, any case). */
export function confirmsTournamentName(typed: string, name: string): boolean {
  return typed.trim().toLowerCase() === name.trim().toLowerCase();
}

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
      slab.increment < MIN_BID_INCREMENT ||
      slab.increment > basePurse / 10
    ) {
      return "Each slab increment must be at least ₹5,000 and at most 10% of the base purse";
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
