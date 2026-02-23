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
