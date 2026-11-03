// convex/policy.ts - Account-level permissions (who may do what across the
// platform). Per-tournament access stays in requireTournamentRole (auth.ts);
// these are the rules that depend on how someone signed up. Change a rule
// here and every caller follows.
import type { Doc } from "./_generated/dataModel";

/** What the user said they're here for. "visitor" is the viewer. */
export type Intent = NonNullable<Doc<"users">["accountType"]>;

/** getTournamentRole's result: the caller's access to one tournament. */
export type TournamentAccess = "super_admin" | "owner" | "auctioneer" | null;

export function isSuperAdmin(user: Doc<"users"> | null): boolean {
  return user?.role === "admin";
}

/**
 * The user's chosen intent, or null when they still have to choose. Choices
 * from before organisers existed carry no accountTypeChosenAt, so everyone
 * is asked once more.
 */
export function intentOf(user: Doc<"users"> | null): Intent | null {
  if (!user?.accountType || user.accountTypeChosenAt === undefined) return null;
  return user.accountType;
}

export function canCreateTournament(user: Doc<"users"> | null): boolean {
  return isSuperAdmin(user) || intentOf(user) === "organiser";
}

/** Auctioneers run the day; the logo is the owner's call. */
export function canUploadTournamentLogo(access: TournamentAccess): boolean {
  return access === "super_admin" || access === "owner";
}
