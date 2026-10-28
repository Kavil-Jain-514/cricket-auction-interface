"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * The caller's access to one tournament (tournaments:myRole), for showing or
 * hiding controls. The server re-checks every action; this is UI only.
 * - canManage: owner (or super-admin): settings, teams, players, staff…
 * - canRunAuction: owner or auctioneer: the live console, corrections, purse tools
 */
export function useTournamentRole(tournamentId: Id<"tournaments"> | undefined) {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const role = useQuery(
    api.tournaments.myRole,
    isAuthenticated && tournamentId ? { tournamentId } : "skip",
  );
  const resolved = isAuthenticated ? (role ?? null) : null;
  return {
    role: resolved,
    isLoading: isAuthLoading || (isAuthenticated && !!tournamentId && role === undefined),
    canManage: resolved === "owner" || resolved === "super_admin",
    canRunAuction: resolved !== null,
    isSuperAdmin: resolved === "super_admin",
  };
}
