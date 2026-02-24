import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return `₹${(amount / 100000).toFixed(2)}L`;
}

export function getPlayerInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Extract a clean, user-friendly error message from Convex or generic errors.
 * Strips prefixes like "Uncaught Error:", "ConvexError:", "[Server Error]" etc.
 */
export function getErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (!error) return fallback;

  let message = "";
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (typeof error === "object" && error !== null && "message" in error) {
    message = String((error as { message: unknown }).message);
  } else {
    return fallback;
  }

  // Strip Convex-added prefixes
  message = message
    .replace(/^Uncaught Error:\s*/i, "")
    .replace(/^\[Server Error\]\s*/i, "")
    .replace(/^ConvexError:\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();

  return message || fallback;
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
export type PlayerRole = (typeof PLAYER_ROLES)[number];

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
 * Get the primary role color CSS classes for a player (based on first role).
 */
export function getRoleColor(role: string | string[]): string {
  const primary = getRoles(role)[0];
  if (primary === "Batter") return "bg-blue-500/20 text-blue-400";
  if (primary === "Bowler") return "bg-orange-500/20 text-orange-400";
  if (primary === "Wicket Keeper") return "bg-emerald-500/20 text-emerald-400";
  if (primary?.includes("All")) return "bg-purple-500/20 text-purple-400";
  return "bg-slate-500/20 text-slate-400";
}
