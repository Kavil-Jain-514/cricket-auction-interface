import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { ConvexError } from "convex/values";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Short format used in UI — always shows Lakhs: ₹1.50L */
export function formatCurrency(amount: number): string {
  return `₹${(amount / 100000).toFixed(2)}L`;
}

/**
 * Full format for documents and PDFs — picks the most readable unit:
 * ≥1 Cr → "Rs.X.XX Cr", ≥1 L → "Rs.X.XX L", ≥1K → "Rs.X.XK", else "Rs.X"
 */
export function formatCurrencyFull(amount: number): string {
  if (amount >= 10000000) return `Rs.${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `Rs.${(amount / 100000).toFixed(2)} L`;
  if (amount >= 1000) return `Rs.${(amount / 1000).toFixed(1)}K`;
  return `Rs.${amount}`;
}

export function getPlayerInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const NETWORK_MESSAGE = "We couldn't reach the server. Check your connection and try again.";
const INVALID_INPUT_MESSAGE = "Some of the details entered aren\u2019t valid. Check the form and try again.";

/**
 * A clean, user-friendly message from any error a mutation, action or fetch
 * can throw.
 * - ConvexError (what convex/*.ts throws for expected failures): its message,
 *   which production deployments pass to the client.
 * - Other errors: Convex's "[CONVEX M(fn)] [Request ID: …] Server Error"
 *   wrapper, "Uncaught Error:" and the stack trace are stripped (development).
 * - A redacted production error ("Server Error") has nothing to show, so the
 *   caller's `fallback` is used, with "Please try again."
 */
export function getErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (!error) return fallback;

  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (typeof data === "string" && data.trim()) return data.trim();
    if (data && typeof data === "object" && "message" in data && typeof data.message === "string" && data.message.trim()) {
      return data.message.trim();
    }
    return fallback;
  }

  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (typeof error === "object" && "message" in error) {
    message = String((error as { message: unknown }).message);
  } else {
    return fallback;
  }

  if (/failed to fetch|networkerror|network request failed|connection lost|load failed/i.test(message)) {
    return NETWORK_MESSAGE;
  }
  if (/ArgumentValidationError|does not match validator/i.test(message)) return INVALID_INPUT_MESSAGE;

  const cleaned = message
    // "[CONVEX M(fn)] [Request ID: x] Server Error" wrapper (dev and prod)
    .replace(/^\s*\[CONVEX [A-Z]\([^)]*\)\]\s*/i, "")
    .replace(/^\s*\[Request ID: [^\]]*\]\s*/i, "")
    .replace(/^\s*\[?Server Error\]?\s*/i, "")
    // Development adds the original error and its stack on the next lines.
    .replace(/^\s*Uncaught\s+/i, "")
    .replace(/^\s*(ConvexError|Error):\s*/i, "")
    .split("\n")
    .filter((line) => !/^\s+at\s/.test(line) && !/^\s*Called by client\s*$/i.test(line))
    .join("\n")
    .trim();

  if (!cleaned || /^server error$/i.test(cleaned)) return `${fallback.replace(/[.!]$/, "")}. Please try again.`;
  return cleaned;
}

/**
 * Optimize Cloudinary image URLs by injecting format, quality, and width transforms.
 * Non-Cloudinary URLs are returned unchanged.
 */
export function optimizeImageUrl(url: string | undefined | null, width = 200): string | undefined {
  if (!url) return undefined;
  if (!url.includes("res.cloudinary.com")) return url;
  // Avoid double-transforming
  if (url.includes("/f_auto")) return url;
  return url.replace("/upload/", `/upload/f_auto,q_auto,w_${width}/`);
}

/** Valid player roles */
export const PLAYER_ROLES = ["Batter", "Bowler", "All-Rounder", "Wicket Keeper"] as const;

/**
 * Set of player ids that are team captains. Captains are pre-assigned and never
 * auctioned, so they must be excluded from every pending/sold/total count.
 */
export function getCaptainPlayerIds(
  teams: ReadonlyArray<{ captainPlayerId?: string }> | undefined | null,
): Set<string> {
  return new Set(
    (teams ?? []).flatMap((t) => (t.captainPlayerId ? [t.captainPlayerId] : [])),
  );
}

/**
 * Normalize player role to an array. Handles both legacy single string
 * ("Batter") and new array format (["Batter", "Wicket Keeper"]).
 */
export function getRoles(role: string | string[]): string[] {
  if (Array.isArray(role)) return role;
  if (role === "All Rounder") return ["All-Rounder"];
  return [role];
}

/**
 * Display-friendly string for player roles, e.g. "Batter / Wicket Keeper"
 */
export function getRoleDisplay(role: string | string[]): string {
  return getRoles(role).join(" / ");
}

/**
 * Solid role badge background class — used for compact colored pills (e.g. PlayerCard tags).
 * Handles legacy "All Rounder" and hyphenated "Wicket-Keeper" spellings.
 */
export function getRoleBadgeBg(role: string): string {
  if (role === "Batter") return "bg-blue-600";
  if (role === "Bowler") return "bg-orange-600";
  if (role === "All-Rounder" || role === "All Rounder") return "bg-purple-600";
  if (role === "Wicket Keeper" || role === "Wicket-Keeper") return "bg-emerald-600";
  return "bg-slate-600";
}

/** Solid status badge background class for auction status indicators. */
export function getStatusBadgeBg(status: string): string {
  if (status === "pending") return "bg-slate-600";
  if (status === "in_auction") return "bg-yellow-600";
  if (status === "sold") return "bg-green-600";
  if (status === "unsold") return "bg-red-600";
  if (status === "final_unsold") return "bg-red-900";
  return "bg-slate-600";
}
